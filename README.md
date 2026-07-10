# dex-arb-bot — Uniswap V2 ↔ SushiSwap atomic arbitrage

A two-part system that continuously monitors Uniswap V2 and SushiSwap for
short-lived price discrepancies in identical TOKEN/WETH pairs and captures
them atomically:

- **`contracts/`** — `FlashArbitrage.sol`, an on-chain executor that performs
  the entire buy-cheap/sell-dear cycle in one transaction. Default mode uses
  **V2 flash swaps**, so it needs **zero trading capital** — only gas is ever
  at risk.
- **`bot/`** — a TypeScript daemon that watches pool reserves every block,
  computes the profit-maximizing trade size in closed form, and submits
  transactions **privately via Flashbots** so they can't be front-run.

```
        every block                     profitable?                  private tx
┌────────────────┐  Multicall3   ┌──────────────────────┐  Flashbots  ┌──────────────┐
│  WS/HTTP node  │ ────────────► │ bot: closed-form      │ ──────────► │ FlashArbitrage│
│  (block feed)  │  getReserves  │ optimal size + gas    │  (or public)│  .executeFlash│
└────────────────┘  both DEXes   │ + bribe thresholding  │             └──────┬───────┘
                                 └──────────────────────┘                     │ atomic
                     ┌─────────────────────────────────────────────────────── ▼ ─────┐
                     │ 1. flash-borrow TOKEN from cheap pool                          │
                     │ 2. sell TOKEN on expensive pool for WETH                       │
                     │ 3. repay cheap pool in WETH, keep the difference               │
                     │    (reverts unless profit ≥ minProfit — can never lose funds)  │
                     └────────────────────────────────────────────────────────────────┘
```

## How the strategy works

Both DEXes are constant-product AMMs charging a 0.3% fee (γ = 0.997). When the
same token trades at different prices, there is a WETH → TOKEN → WETH cycle
with positive return iff `γ² · (priceB / priceA) > 1`. The WETH received for
input `x` (buy pool reserves `a₁,b₁`; sell pool `a₂,b₂`, WETH/token) is

```
z(x) = γ²·a₂·b₁·x / (a₁·b₂ + γ·x·(b₂ + γ·b₁))
```

and the profit-maximizing input has the closed form

```
x* = (γ·√(a₁·b₂·a₂·b₁) − a₁·b₂) / (γ·(b₂ + γ·b₁))
```

The bot evaluates both directions for every watched token each block
(`bot/src/math.ts`, all bigint — floats never touch amounts), converts `x*`
into a flash-borrow size, subtracts worst-case gas and the builder bribe, and
fires only when the remainder clears `MIN_NET_PROFIT_ETH`.

## Execution modes

| | `MODE=flash` (default) | `MODE=funded` |
|---|---|---|
| Capital required | none (flash swap) | contract pre-funded with WETH |
| Risk if outcompeted | gas only (tx reverts) | gas only (tx reverts) |
| Measured gas (mock pools) | ~122k | ~98k |
| Real-world estimate | ~180–220k | ~150–190k |

Funded mode chains the swaps pair-to-pair (no callback), saving ~25k gas per
trade; flash mode needs no inventory. Both recompute every amount from live
reserves on-chain and revert with `InsufficientProfit` if the edge shrank
below `minProfit` before inclusion.

## Security model

**On-chain (`FlashArbitrage.sol`)**

- **Two-key design.** The `owner` (cold key, immutable) is the only address
  that can withdraw funds or rotate keys. The `executor` (hot key on the bot
  machine) can only trigger arbitrage — a compromised bot key cannot steal the
  contract's balance, worst case it wastes gas.
- **No trusted pair inputs.** Pair addresses are derived on-chain via CREATE2
  from the factory address + init code hash, exactly like
  `UniswapV2Library.pairFor`. A malicious "pair" contract can never be
  injected, even by the executor.
- **Authenticated flash callback.** `uniswapV2Call` is guarded by an EIP-1153
  transient-storage lock: it accepts calls only from the exact pair the
  contract is mid-flight with, only within the same transaction, and only when
  initiated by the contract itself. This doubles as reentrancy protection and
  costs ~200 gas instead of a 20k-gas storage guard.
- **Profit-or-revert invariant.** Amounts are recomputed from live reserves
  and gated by `minProfit` *before* any token moves; the pools' own K-checks
  enforce repayment. The fuzz suite asserts the contract either reverts or
  ends the transaction strictly richer — there is no code path that settles at
  a loss. Fee-on-transfer tokens fail safely (revert, not loss).
- **No lingering approvals.** Tokens are pushed with direct transfers; the
  contract never grants an allowance to anything.
- **Deadline blocks.** Every execution carries a `deadlineBlock` so a stale
  transaction stuck in a queue expires instead of executing against dead state.

**Operational (bot)**

- **Private submission by default.** `eth_sendPrivateTransaction` to Flashbots
  keeps the tx out of the public mempool: no copy-trading of your calldata, no
  sandwiching, and failed opportunities cost nothing because reverting private
  txs are simply not included.
- **Dry-run by default.** `DRY_RUN=true` logs every decision without sending
  anything; flip it only after you've watched it behave.
- **Simulation preflight.** The exact calldata is `eth_call`-ed before
  sending; any disagreement between bot math and chain state aborts the send.
- **Untrusted-RPC tolerance.** A lying RPC can at worst make the bot submit a
  transaction that reverts on the on-chain profit gate — it cannot make it
  trade at a loss.
- **Key hygiene.** Keys come from the environment, are never logged, and the
  executor wallet needs only gas money. Withdrawals go to the cold owner only.

## Gas-efficiency design

- CREATE2 pair derivation (pure keccak) instead of `factory.getPair` external
  calls; single packed-slot `getReserves` read per pool.
- Transient storage (`tstore`/`tload`) for the callback lock — ~100 gas vs
  ~20k+ for a storage-based mutex.
- Custom errors everywhere (no revert strings), immutables for all config,
  `unchecked` only where a prior gate proves safety, optimizer at 10k runs.
- Cheap failure path: the profit gate reverts on two reserve reads and pure
  math (~30k gas) before any external state changes.
- The unprofitable-revert path is mostly irrelevant in practice: Flashbots
  drops reverting transactions for free.
- Funded mode chains `swap()` outputs directly into the next pair, skipping
  an entire ERC20 transfer plus the callback dispatch.

## Repository layout

```
contracts/
  src/FlashArbitrage.sol      the on-chain executor
  test/FlashArbitrage.t.sol   Foundry suite incl. never-lose fuzz invariants
  test/mocks/Mocks.sol        V2-faithful pair/factory/WETH mocks (K-check + callback)
  script/Deploy.s.sol         forge deploy script (mainnet defaults baked in)
bot/
  src/index.ts                main loop: block feed → evaluate → execute
  src/math.ts                 closed-form optimal sizing (bigint)
  src/monitor.ts              Multicall3 batched reserve reads
  src/executor.ts             tx building, simulation, submission, receipts
  src/flashbots.ts            eth_sendPrivateTransaction client
  src/pairs.ts                CREATE2 pair derivation (mirrors the contract)
  src/config.ts               env parsing with fail-closed validation
  test/                       node:test suite (math properties + known mainnet pairs)
```

No git submodules and a single runtime dependency (`ethers`) — a deliberately
small supply-chain surface for code that handles keys.

## Setup

### 0. Prerequisites

- Node.js ≥ 22.18, [Foundry](https://book.getfoundry.sh/getting-started/installation)
- An Ethereum node/provider (WebSocket endpoint recommended)
- Two fresh keys: a **cold owner** key (hardware wallet / air-gapped) and a
  **hot executor** key (bot machine, gas money only)

### 1. Test & deploy the contract

```bash
cd contracts
forge test -vv          # full suite incl. fuzz invariants

ARB_OWNER=0xYourColdKey ARB_EXECUTOR=0xYourHotKey \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --broadcast
```

Mainnet Uniswap V2 + SushiSwap addresses are the defaults; override
`FACTORY_A/B`, `INIT_CODE_HASH_A/B`, `WETH_ADDRESS` for other networks/forks.

### 2. Configure the bot

```bash
cd bot
npm install && npm test
cp .env.example .env            # fill in RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS
cp tokens.example.json tokens.json  # edit the watchlist
```

### 3. Dry run, then go live

```bash
npm start                        # DRY_RUN=true: watch it think, send nothing
# … once satisfied:
# set DRY_RUN=false in .env
npm start
```

For funded mode, transfer WETH directly to the contract address (withdraw any
time with `withdrawToken` from the owner key).

## Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `RPC_URL` | — | `wss://` (push) or `https://` (polling) endpoint |
| `PRIVATE_KEY` | — | executor hot key (only needed live) |
| `CONTRACT_ADDRESS` | — | deployed `FlashArbitrage` |
| `DRY_RUN` | `true` | log opportunities without sending |
| `MODE` | `flash` | `flash` (no capital) or `funded` (cheaper gas) |
| `SUBMIT` | `flashbots` | `flashbots` (private) or `public` mempool |
| `MIN_NET_PROFIT_ETH` | `0.005` | minimum profit after gas + bribe |
| `BRIBE_BPS` | `5000` | share of gross profit paid to the block builder |
| `PRIORITY_FEE_GWEI` | `2` | EIP-1559 tip |
| `GAS_UNITS_ESTIMATE` | `220000` | expected gas used (thresholding) |
| `GAS_LIMIT` | `350000` | hard cap on the tx |
| `DEADLINE_BLOCKS` | `2` | validity window (on-chain + relay) |
| `SIMULATE` | `true` | `eth_call` preflight of exact calldata |
| `TOKENS_FILE` | `tokens.json` | watchlist path |
| `LOG_LEVEL` | `info` | `debug` prints per-token per-block numbers |

## Honest limitations

- **This is a hyper-competitive game.** V2↔Sushi two-pool arbitrage is the
  most farmed strategy in MEV; professional searchers run colocated nodes,
  bid ~99% of profit to builders, and win most blocks. Treat this as a
  production-quality reference implementation and a base to extend (more pool
  types, multi-hop cycles, your own edge) — not free money.
- Uniswap **V2**-style pools only (x·y=k with 0.3% fee). V3/V4 concentrated
  liquidity needs different math and calldata.
- One arbitrage in flight at a time (single nonce lane) — correct, simple,
  and enough for a single-key setup.
- Fee-on-transfer / rebasing tokens are intentionally unsupported (they revert
  safely; don't watchlist them).
- Bot and contract were verified with unit tests, property/fuzz tests and an
  in-EVM end-to-end suite; run your own fork tests before risking real funds,
  and start with small `MIN_NET_PROFIT_ETH` thresholds and tiny funded
  balances.

## License

MIT

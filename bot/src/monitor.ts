import { Contract, Interface, type Provider } from 'ethers';
import { ERC20_ABI, MULTICALL3_ABI, PAIR_ABI } from './abi.ts';
import type { Config } from './config.ts';
import type { PoolReserves } from './math.ts';
import { pairFor, type WatchedToken } from './pairs.ts';
import { log } from './logger.ts';

export interface TokenSnapshot {
  token: WatchedToken;
  poolA: PoolReserves | null;
  poolB: PoolReserves | null;
}

export interface ChainSnapshot {
  tokens: TokenSnapshot[];
  /** WETH held by the arbitrage contract (funded-mode budget), if requested */
  contractWethBalance: bigint | null;
}

const pairIface = new Interface(PAIR_ABI as unknown as string[]);
const erc20Iface = new Interface(ERC20_ABI as unknown as string[]);
const getReservesData = pairIface.encodeFunctionData('getReserves');

/** Derives all watched pairs once and batch-reads reserves via Multicall3. */
export class ReserveMonitor {
  private readonly multicall: Contract;
  private readonly watched: WatchedToken[];
  private readonly balanceOfContract: string | null;
  /** pairs that turned out not to exist — reported once, then skipped */
  private readonly dead = new Set<string>();

  private readonly cfg: Config;

  constructor(provider: Provider, cfg: Config) {
    this.cfg = cfg;
    this.multicall = new Contract(cfg.multicall3, MULTICALL3_ABI as unknown as string[], provider);
    this.watched = cfg.tokens.map((t) => ({
      symbol: t.symbol,
      address: t.address,
      decimals: t.decimals,
      pairA: pairFor(cfg.factoryA, cfg.initCodeHashA, t.address, cfg.weth),
      pairB: pairFor(cfg.factoryB, cfg.initCodeHashB, t.address, cfg.weth),
      tokenIs0: BigInt(t.address) < BigInt(cfg.weth),
    }));
    this.balanceOfContract =
      cfg.mode === 'funded' && cfg.contractAddress !== null
        ? erc20Iface.encodeFunctionData('balanceOf', [cfg.contractAddress])
        : null;
  }

  get tokens(): readonly WatchedToken[] {
    return this.watched;
  }

  async snapshot(blockTag: number | 'latest' = 'latest'): Promise<ChainSnapshot> {
    const calls: { target: string; allowFailure: boolean; callData: string }[] = [];
    for (const t of this.watched) {
      calls.push({ target: t.pairA, allowFailure: true, callData: getReservesData });
      calls.push({ target: t.pairB, allowFailure: true, callData: getReservesData });
    }
    if (this.balanceOfContract !== null) {
      calls.push({ target: this.cfg.weth, allowFailure: false, callData: this.balanceOfContract });
    }

    const fn = this.multicall.getFunction('aggregate3');
    const results = (await fn.staticCall(calls, { blockTag })) as {
      success: boolean;
      returnData: string;
    }[];

    const tokens: TokenSnapshot[] = this.watched.map((token, i) => ({
      token,
      poolA: this.decodeReserves(token, results[2 * i], token.pairA),
      poolB: this.decodeReserves(token, results[2 * i + 1], token.pairB),
    }));

    let contractWethBalance: bigint | null = null;
    if (this.balanceOfContract !== null) {
      const last = results[results.length - 1];
      if (last !== undefined && last.success) {
        contractWethBalance = BigInt(erc20Iface.decodeFunctionResult('balanceOf', last.returnData)[0]);
      }
    }
    return { tokens, contractWethBalance };
  }

  private decodeReserves(
    token: WatchedToken,
    result: { success: boolean; returnData: string } | undefined,
    pair: string,
  ): PoolReserves | null {
    if (result === undefined || !result.success || result.returnData === '0x') {
      if (!this.dead.has(pair)) {
        this.dead.add(pair);
        log.warn(`${token.symbol}: pair ${pair} unreadable (does it exist?) — skipping`);
      }
      return null;
    }
    const [r0, r1] = pairIface.decodeFunctionResult('getReserves', result.returnData);
    const reserve0 = BigInt(r0);
    const reserve1 = BigInt(r1);
    if (reserve0 === 0n || reserve1 === 0n) return null;
    return token.tokenIs0
      ? { token: reserve0, weth: reserve1 }
      : { token: reserve1, weth: reserve0 };
  }
}

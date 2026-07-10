import {
  type AbstractProvider,
  Contract,
  formatEther,
  JsonRpcProvider,
  WebSocketProvider,
} from 'ethers';
import { FLASH_ARBITRAGE_ABI } from './abi.ts';
import { loadConfig, type Config } from './config.ts';
import { Executor, type Opportunity } from './executor.ts';
import { log, setLogLevel } from './logger.ts';
import { planArbitrage, planDirectionWithInput, requiredGrossProfit, type ArbPlan } from './math.ts';
import { ReserveMonitor, type ChainSnapshot } from './monitor.ts';
import { BASE_FEE_MAX_INCREASE_DEN, BASE_FEE_MAX_INCREASE_NUM } from './constants.ts';

interface Stack {
  provider: AbstractProvider;
  monitor: ReserveMonitor;
  executor: Executor;
}

let inflight = false; // one live arbitrage tx at a time
let processing = false; // one block evaluation at a time
let lastBlockAt = Date.now();
let shuttingDown = false;

function buildProvider(cfg: Config): AbstractProvider {
  const network = Number(cfg.chainId);
  return cfg.rpcUrl.startsWith('ws')
    ? new WebSocketProvider(cfg.rpcUrl, network)
    : new JsonRpcProvider(cfg.rpcUrl, network, { staticNetwork: true });
}

function buildStack(cfg: Config): Stack {
  const provider = buildProvider(cfg);
  return { provider, monitor: new ReserveMonitor(provider, cfg), executor: new Executor(cfg, provider) };
}

async function handleBlock(cfg: Config, stack: Stack, blockNumber: number): Promise<void> {
  lastBlockAt = Date.now();
  const [block, snapshot] = await Promise.all([
    stack.provider.getBlock(blockNumber),
    stack.monitor.snapshot(),
  ]);

  let baseFee = block?.baseFeePerGas ?? null;
  if (baseFee === null) {
    const feeData = await stack.provider.getFeeData();
    baseFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  }
  // Assume worst-case base fee for the block we are actually targeting.
  const nextBaseFee = (baseFee * BASE_FEE_MAX_INCREASE_NUM) / BASE_FEE_MAX_INCREASE_DEN + 1n;
  const gasCostWei = cfg.gasUnitsEstimate * (nextBaseFee + cfg.priorityFeeWei);
  const requiredGross = requiredGrossProfit(cfg.minNetProfitWei, gasCostWei, cfg.bribeBps);

  let best: Opportunity | null = null;
  for (const snap of snapshot.tokens) {
    if (snap.poolA === null || snap.poolB === null) continue;
    let plan = planArbitrage(snap.poolA, snap.poolB);
    if (plan !== null && cfg.mode === 'funded') {
      plan = capToBudget(plan, snap, snapshot);
    }
    if (plan === null) continue;

    log.debug(
      `block ${blockNumber} ${snap.token.symbol}: buyOn${plan.buyOnA ? 'A' : 'B'} ` +
        `gross=${formatEther(plan.grossProfit)} WETH (need ${formatEther(requiredGross)})`,
    );
    if (plan.grossProfit < requiredGross) continue;
    if (best === null || plan.grossProfit > best.plan.grossProfit) {
      best = { token: snap.token, plan, requiredGross, observedBlock: blockNumber };
    }
  }

  if (best === null) return;
  const b = best;
  log.info(
    `block ${blockNumber}: opportunity ${b.token.symbol} buyOn${b.plan.buyOnA ? 'A' : 'B'} ` +
      `gross=${formatEther(b.plan.grossProfit)} WETH ` +
      `(threshold ${formatEther(requiredGross)}, gas est ${formatEther(gasCostWei)} ETH)`,
  );
  if (inflight) {
    log.info('previous arbitrage still in flight — skipping this one');
    return;
  }
  inflight = true;
  stack.executor
    .execute(b, baseFee)
    .catch((err: unknown) => log.error(`execution failed: ${(err as Error).message}`))
    .finally(() => {
      inflight = false;
    });
}

/** Funded mode can only spend what the contract holds — re-plan at the cap. */
function capToBudget(
  plan: ArbPlan,
  snap: ChainSnapshot['tokens'][number],
  snapshot: ChainSnapshot,
): ArbPlan | null {
  const budget = snapshot.contractWethBalance;
  if (budget === null || plan.wethIn <= budget) return plan;
  if (budget <= 0n || snap.poolA === null || snap.poolB === null) return null;
  const [buy, sell] = plan.buyOnA ? [snap.poolA, snap.poolB] : [snap.poolB, snap.poolA];
  return planDirectionWithInput(buy, sell, plan.buyOnA, budget);
}

async function startupChecks(cfg: Config, stack: Stack): Promise<void> {
  const net = await stack.provider.getNetwork();
  if (net.chainId !== cfg.chainId) {
    throw new Error(`RPC chainId ${net.chainId} != configured ${cfg.chainId}`);
  }
  log.info(`connected to chain ${net.chainId} via ${cfg.rpcUrl.split('://')[0]}`);

  for (const t of stack.monitor.tokens) {
    log.info(`watching ${t.symbol.padEnd(6)} A=${t.pairA} B=${t.pairB}`);
  }

  if (cfg.dryRun) {
    log.warn('DRY_RUN=true — opportunities will be logged, nothing will be sent');
    return;
  }
  if (cfg.contractAddress === null) throw new Error('CONTRACT_ADDRESS missing');

  const code = await stack.provider.getCode(cfg.contractAddress);
  if (code === '0x') throw new Error(`no contract deployed at ${cfg.contractAddress}`);

  const arb = new Contract(cfg.contractAddress, FLASH_ARBITRAGE_ABI as unknown as string[], stack.provider);
  const onChainExecutor = (await arb.getFunction('executor').staticCall()) as string;
  const me = stack.executor.executorAddress;
  if (me === null || onChainExecutor.toLowerCase() !== me.toLowerCase()) {
    log.warn(
      `contract executor is ${onChainExecutor} but our key is ${me} — ` +
        'every execution will revert until setExecutor() is called',
    );
  }
  if (me !== null) {
    const balance = await stack.provider.getBalance(me);
    log.info(`executor ${me} gas balance: ${formatEther(balance)} ETH`);
    if (balance < 5n * 10n ** 16n) log.warn('executor holds < 0.05 ETH — top up for gas');
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  log.info(`dex-arb-bot starting — mode=${cfg.mode} submit=${cfg.submit} dryRun=${cfg.dryRun}`);

  let stack = buildStack(cfg);
  await startupChecks(cfg, stack);

  const onBlock = (blockNumber: number): void => {
    if (shuttingDown || processing) return;
    processing = true;
    handleBlock(cfg, stack, blockNumber)
      .catch((err: unknown) => log.error(`block ${blockNumber}: ${(err as Error).message}`))
      .finally(() => {
        processing = false;
      });
  };

  let pollTimer: NodeJS.Timeout | null = null;
  let lastPolled = 0;

  const subscribe = async (): Promise<void> => {
    if (cfg.rpcUrl.startsWith('ws')) {
      await (stack.provider as WebSocketProvider).on('block', onBlock);
    } else {
      pollTimer = setInterval(() => {
        stack.provider
          .getBlockNumber()
          .then((n) => {
            if (n > lastPolled) {
              lastPolled = n;
              onBlock(n);
            }
          })
          .catch((err: unknown) => log.debug(`poll failed: ${(err as Error).message}`));
      }, cfg.pollIntervalMs);
    }
  };

  // Watchdog: if the connection goes quiet, tear it down and rebuild.
  const watchdog = setInterval(() => {
    if (shuttingDown || Date.now() - lastBlockAt < 90_000) return;
    log.warn('no blocks for 90s — recycling provider connection');
    lastBlockAt = Date.now();
    if (pollTimer !== null) clearInterval(pollTimer);
    stack.provider.destroy();
    stack = buildStack(cfg);
    void subscribe().catch((err: unknown) => log.error(`resubscribe failed: ${(err as Error).message}`));
  }, 15_000);

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down…');
    clearInterval(watchdog);
    if (pollTimer !== null) clearInterval(pollTimer);
    stack.provider.destroy();
    setTimeout(() => process.exit(0), 250);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await subscribe();
  log.info('monitoring for cross-DEX price discrepancies…');
}

main().catch((err: unknown) => {
  log.error((err as Error).stack ?? String(err));
  process.exit(1);
});

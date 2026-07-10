import { formatEther, Interface, Wallet, type Provider, type TransactionReceipt } from 'ethers';
import { FLASH_ARBITRAGE_ABI } from './abi.ts';
import type { Config } from './config.ts';
import { BASE_FEE_MAX_INCREASE_DEN, BASE_FEE_MAX_INCREASE_NUM } from './constants.ts';
import { sendPrivateTransaction } from './flashbots.ts';
import { log } from './logger.ts';
import type { ArbPlan } from './math.ts';
import type { WatchedToken } from './pairs.ts';

export interface Opportunity {
  token: WatchedToken;
  plan: ArbPlan;
  /** on-chain minProfit: gross profit needed to clear gas + bribe + minNet */
  requiredGross: bigint;
  /** block the reserves were observed at */
  observedBlock: number;
}

const iface = new Interface(FLASH_ARBITRAGE_ABI as unknown as string[]);

export class Executor {
  private readonly cfg: Config;
  private readonly provider: Provider;
  private readonly wallet: Wallet | null;
  private readonly flashbotsSigner: Wallet | null;

  constructor(cfg: Config, provider: Provider) {
    this.cfg = cfg;
    this.provider = provider;
    this.wallet = cfg.privateKey === null ? null : new Wallet(cfg.privateKey, provider);
    this.flashbotsSigner =
      cfg.flashbotsSignerKey !== null
        ? new Wallet(cfg.flashbotsSignerKey)
        : this.wallet !== null
          ? new Wallet(this.wallet.privateKey)
          : null;
  }

  get executorAddress(): string | null {
    return this.wallet?.address ?? null;
  }

  /**
   * Worst-case maxFeePerGas so the tx stays valid for `blocks` blocks even if
   * every one of them hits the +12.5% base-fee ceiling.
   */
  private projectMaxFee(baseFee: bigint, blocks: number): bigint {
    let projected = baseFee;
    for (let i = 0; i < blocks; i++) {
      projected = (projected * BASE_FEE_MAX_INCREASE_NUM) / BASE_FEE_MAX_INCREASE_DEN + 1n;
    }
    return projected + this.cfg.priorityFeeWei;
  }

  async execute(opp: Opportunity, baseFee: bigint): Promise<void> {
    const { token, plan } = opp;
    const deadlineBlock = opp.observedBlock + this.cfg.deadlineBlocks;
    const amountIn = this.cfg.mode === 'flash' ? plan.tokenAmount : plan.wethIn;
    const method = this.cfg.mode === 'flash' ? 'executeFlash' : 'executeFunded';
    const data = iface.encodeFunctionData(method, [
      token.address,
      amountIn,
      opp.requiredGross,
      deadlineBlock,
      plan.buyOnA,
      this.cfg.bribeBps,
    ]);

    const txRequest = {
      to: this.cfg.contractAddress,
      data,
      value: 0n,
      gasLimit: this.cfg.gasLimit,
      chainId: this.cfg.chainId,
      type: 2,
      maxPriorityFeePerGas: this.cfg.priorityFeeWei,
      maxFeePerGas: this.projectMaxFee(baseFee, this.cfg.deadlineBlocks),
    };

    // Preflight the exact calldata against latest state: a revert here means
    // our math disagrees with the chain (or the edge just vanished) — abort
    // before risking gas.
    if (this.cfg.simulate && this.cfg.contractAddress !== null) {
      try {
        await this.provider.call({
          ...txRequest,
          from: this.wallet?.address ?? undefined,
        });
      } catch (err) {
        log.warn(
          `${token.symbol}: simulation reverted, skipping — ${(err as Error).message.slice(0, 200)}`,
        );
        return;
      }
    }

    if (this.cfg.dryRun) {
      log.info(
        `[DRY RUN] would send ${method} ${token.symbol}: ` +
          `amountIn=${amountIn} buyOnA=${plan.buyOnA} ` +
          `expectedGross=${formatEther(plan.grossProfit)} WETH ` +
          `minProfit=${formatEther(opp.requiredGross)} WETH deadline=${deadlineBlock}`,
      );
      return;
    }
    if (this.wallet === null || this.flashbotsSigner === null) {
      throw new Error('cannot execute live without PRIVATE_KEY');
    }

    const nonce = await this.wallet.getNonce('pending');
    const signed = await this.wallet.signTransaction({ ...txRequest, nonce });

    let txHash: string;
    if (this.cfg.submit === 'flashbots') {
      txHash = await sendPrivateTransaction(
        this.cfg.flashbotsRelay,
        this.flashbotsSigner,
        signed,
        deadlineBlock,
      );
      log.info(`${token.symbol}: sent private tx ${txHash} (valid through block ${deadlineBlock})`);
    } else {
      const response = await this.provider.broadcastTransaction(signed);
      txHash = response.hash;
      log.info(`${token.symbol}: broadcast public tx ${txHash}`);
    }

    await this.awaitOutcome(token, txHash, deadlineBlock);
  }

  private async awaitOutcome(
    token: WatchedToken,
    txHash: string,
    deadlineBlock: number,
  ): Promise<void> {
    const timeoutMs = (this.cfg.deadlineBlocks + 2) * 12_000;
    let receipt: TransactionReceipt | null = null;
    try {
      receipt = await this.provider.waitForTransaction(txHash, 1, timeoutMs);
    } catch {
      /* timeout — handled below */
    }
    if (receipt === null) {
      log.info(`${token.symbol}: tx ${txHash} not included by block ${deadlineBlock} — expired`);
      return;
    }
    if (receipt.status !== 1) {
      log.warn(`${token.symbol}: tx ${txHash} REVERTED (gas spent, no loss of funds)`);
      return;
    }
    const gasCost = receipt.gasUsed * (receipt.gasPrice ?? 0n);
    for (const entry of receipt.logs) {
      if (entry.address.toLowerCase() !== this.cfg.contractAddress?.toLowerCase()) continue;
      const parsed = iface.parseLog({ topics: [...entry.topics], data: entry.data });
      if (parsed?.name !== 'ArbitrageExecuted') continue;
      const gross = BigInt(parsed.args.grossProfit);
      const bribe = BigInt(parsed.args.bribe);
      log.info(
        `${token.symbol}: ✅ arbitrage landed in block ${receipt.blockNumber} — ` +
          `gross=${formatEther(gross)} WETH, bribe=${formatEther(bribe)}, ` +
          `gas=${formatEther(gasCost)} ETH, net=${formatEther(gross - bribe - gasCost)} ETH`,
      );
      return;
    }
    log.info(`${token.symbol}: tx ${txHash} mined in block ${receipt.blockNumber}`);
  }
}

/** Ethereum mainnet defaults. Every value can be overridden via env (see config.ts). */
export const MAINNET = {
  chainId: 1n,
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  /** DEX A = Uniswap V2 */
  factoryA: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  initCodeHashA: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
  /** DEX B = SushiSwap */
  factoryB: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
  initCodeHashB: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  flashbotsRelay: 'https://relay.flashbots.net',
} as const;

/** EIP-1559: base fee can rise at most 12.5% per block. */
export const BASE_FEE_MAX_INCREASE_NUM = 1125n;
export const BASE_FEE_MAX_INCREASE_DEN = 1000n;

export const BPS = 10_000n;

import { getAddress, getCreate2Address, solidityPackedKeccak256 } from 'ethers';

/** Sort two token addresses the way UniswapV2Factory does (numeric ascending). */
export function sortTokens(tokenA: string, tokenB: string): [string, string] {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  if (a === b) throw new Error('identical tokens');
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

/**
 * Off-chain CREATE2 pair derivation, mirroring UniswapV2Library.pairFor and
 * FlashArbitrage._pairFor. No RPC round-trip needed to locate a pair.
 */
export function pairFor(
  factory: string,
  initCodeHash: string,
  tokenA: string,
  tokenB: string,
): string {
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const salt = solidityPackedKeccak256(['address', 'address'], [token0, token1]);
  return getCreate2Address(getAddress(factory), salt, initCodeHash);
}

export interface WatchedToken {
  symbol: string;
  address: string;
  decimals: number;
  /** TOKEN/WETH pair on DEX A (Uniswap V2) */
  pairA: string;
  /** TOKEN/WETH pair on DEX B (SushiSwap) */
  pairB: string;
  /** whether the token sorts before WETH (token0 position) */
  tokenIs0: boolean;
}

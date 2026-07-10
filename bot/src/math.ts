/**
 * Constant-product AMM math for two-pool arbitrage, all in bigint.
 *
 * Conventions: the "buy pool" is where WETH goes in and token comes out
 * (token is cheaper there); the "sell pool" is where the token is sold back
 * for WETH. Both pools charge the Uniswap V2 0.3% fee (gamma = 997/1000).
 */

const FEE_NUM = 997n;
const FEE_DEN = 1000n;

/** UniswapV2Library.getAmountOut. Returns 0 for degenerate inputs. */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * FEE_NUM;
  return (amountInWithFee * reserveOut) / (reserveIn * FEE_DEN + amountInWithFee);
}

/** UniswapV2Library.getAmountIn. Returns null when amountOut cannot be sourced. */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint | null {
  if (amountOut <= 0n || reserveIn <= 0n || amountOut >= reserveOut) return null;
  return (reserveIn * amountOut * FEE_DEN) / ((reserveOut - amountOut) * FEE_NUM) + 1n;
}

/** Integer square root (Newton's method), floor(sqrt(n)). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of negative number');
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length + 1) >> 1n); // initial guess >= sqrt(n)
  let y = (x + n / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/**
 * Profit-maximizing WETH input for the WETH -> token -> WETH cycle.
 *
 * With buy-pool reserves (a1 = WETH, b1 = token), sell-pool reserves
 * (a2 = WETH, b2 = token) and fee gamma, the WETH received for input x is
 *
 *   z(x) = gamma^2 * a2 * b1 * x / (a1 * b2 + gamma * x * (b2 + gamma * b1))
 *
 * Setting d(z - x)/dx = 0 gives the closed form
 *
 *   x* = (gamma * sqrt(a1 * b2 * a2 * b1) - a1 * b2) / (gamma * (b2 + gamma * b1))
 *
 * Returns 0 when no profitable input exists (iff gamma^2 * a2 * b1 <= a1 * b2).
 */
export function optimalWethIn(a1: bigint, b1: bigint, a2: bigint, b2: bigint): bigint {
  if (a1 <= 0n || b1 <= 0n || a2 <= 0n || b2 <= 0n) return 0n;
  const s = isqrt(a1 * b2 * a2 * b1);
  const numerator = FEE_NUM * FEE_DEN * s - FEE_DEN * FEE_DEN * a1 * b2;
  if (numerator <= 0n) return 0n;
  const denominator = FEE_NUM * FEE_DEN * b2 + FEE_NUM * FEE_NUM * b1;
  return numerator / denominator;
}

export interface PoolReserves {
  /** WETH-side reserve */
  weth: bigint;
  /** token-side reserve */
  token: bigint;
}

export interface ArbPlan {
  /** true: buy token on pool A (it is cheaper there), sell on B */
  buyOnA: boolean;
  /** optimal WETH spent on the buy pool (funded mode amountIn) */
  wethIn: bigint;
  /** token amount bought / flash-borrowed (flash mode amountIn) */
  tokenAmount: bigint;
  /** WETH owed back to the buy pool in flash mode (~= wethIn) */
  wethOwed: bigint;
  /** WETH received from the sell pool */
  wethOut: bigint;
  /** wethOut - wethOwed */
  grossProfit: bigint;
}

function planDirection(buy: PoolReserves, sell: PoolReserves, buyOnA: boolean): ArbPlan | null {
  let wethIn = optimalWethIn(buy.weth, buy.token, sell.weth, sell.token);
  if (wethIn <= 0n) return null;
  return planDirectionWithInput(buy, sell, buyOnA, wethIn);
}

/** Evaluate the cycle at a specific wethIn (used to cap funded-mode size). */
export function planDirectionWithInput(
  buy: PoolReserves,
  sell: PoolReserves,
  buyOnA: boolean,
  wethIn: bigint,
): ArbPlan | null {
  const tokenAmount = getAmountOut(wethIn, buy.weth, buy.token);
  if (tokenAmount <= 0n || tokenAmount >= sell.token) return null;
  const wethOwed = getAmountIn(tokenAmount, buy.weth, buy.token);
  if (wethOwed === null) return null;
  const wethOut = getAmountOut(tokenAmount, sell.token, sell.weth);
  if (wethOut <= wethOwed) return null;
  return { buyOnA, wethIn, tokenAmount, wethOwed, wethOut, grossProfit: wethOut - wethOwed };
}

/**
 * Best arbitrage plan across both directions, or null when neither is
 * profitable before gas. Reserves for pool A (Uniswap) and pool B (Sushi).
 */
export function planArbitrage(poolA: PoolReserves, poolB: PoolReserves): ArbPlan | null {
  const ab = planDirection(poolA, poolB, true); // buy on A, sell on B
  const ba = planDirection(poolB, poolA, false); // buy on B, sell on A
  if (ab === null) return ba;
  if (ba === null) return ab;
  return ab.grossProfit >= ba.grossProfit ? ab : ba;
}

/**
 * Minimum on-chain gross profit for the trade to clear `minNetProfit` after
 * gas and the builder bribe (bribe is a share of gross profit):
 *
 *   gross * (1 - bribeBps/10^4) - gasCost >= minNet
 */
export function requiredGrossProfit(
  minNetProfit: bigint,
  gasCostWei: bigint,
  bribeBps: bigint,
): bigint {
  const keepBps = 10_000n - bribeBps;
  if (keepBps <= 0n) throw new RangeError('bribeBps must be < 10000');
  const numerator = (minNetProfit + gasCostWei) * 10_000n;
  return (numerator + keepBps - 1n) / keepBps; // ceil division
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAmountIn,
  getAmountOut,
  isqrt,
  optimalWethIn,
  planArbitrage,
  planDirectionWithInput,
  requiredGrossProfit,
} from '../src/math.ts';

/** Deterministic 64-bit LCG so property tests are reproducible. */
function makeRng(seed: bigint): () => bigint {
  const MASK = (1n << 64n) - 1n;
  let state = seed & MASK;
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & MASK;
    return state;
  };
}

const ETHER = 10n ** 18n;

/** Full WETH -> token -> WETH cycle profit at a given input. */
function cycleProfit(
  x: bigint,
  buyWeth: bigint,
  buyToken: bigint,
  sellWeth: bigint,
  sellToken: bigint,
): bigint {
  const tokenAmount = getAmountOut(x, buyWeth, buyToken);
  const wethBack = getAmountOut(tokenAmount, sellToken, sellWeth);
  return wethBack - x;
}

test('getAmountOut matches the canonical V2 vector', () => {
  // 1000 in against 1M/1M reserves -> 996 out (0.3% fee + rounding)
  assert.equal(getAmountOut(1000n, 1_000_000n, 1_000_000n), 996n);
  assert.equal(getAmountOut(0n, 1_000_000n, 1_000_000n), 0n);
});

test('getAmountOut never returns the full output reserve', () => {
  const rng = makeRng(1n);
  for (let i = 0; i < 500; i++) {
    const rIn = (rng() % (10n ** 24n)) + 1n;
    const rOut = (rng() % (10n ** 24n)) + 1n;
    const amountIn = (rng() % (10n ** 24n)) + 1n;
    assert.ok(getAmountOut(amountIn, rIn, rOut) < rOut);
  }
});

test('getAmountIn / getAmountOut are consistent inverses', () => {
  const rng = makeRng(2n);
  for (let i = 0; i < 500; i++) {
    const rIn = (rng() % (10n ** 24n)) + 10n ** 6n;
    const rOut = (rng() % (10n ** 24n)) + 10n ** 6n;
    const x = (rng() % (rIn * 10n)) + 1n;
    const y = getAmountOut(x, rIn, rOut);
    if (y === 0n) continue;
    const xNeeded = getAmountIn(y, rIn, rOut);
    assert.notEqual(xNeeded, null);
    // paying what getAmountIn quotes must yield at least y
    assert.ok(getAmountOut(xNeeded as bigint, rIn, rOut) >= y);
    // and the quote can never exceed what we actually paid (mod rounding)
    assert.ok((xNeeded as bigint) <= x + 1n);
  }
});

test('getAmountIn rejects unsatisfiable outputs', () => {
  assert.equal(getAmountIn(100n, 1000n, 100n), null); // amountOut == reserveOut
  assert.equal(getAmountIn(101n, 1000n, 100n), null);
  assert.equal(getAmountIn(0n, 1000n, 100n), null);
});

test('isqrt returns exact integer floor sqrt', () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(3n), 1n);
  assert.equal(isqrt(4n), 2n);
  const rng = makeRng(3n);
  for (let i = 0; i < 300; i++) {
    const n = rng() * rng(); // up to ~2^128
    const s = isqrt(n);
    assert.ok(s * s <= n);
    assert.ok((s + 1n) * (s + 1n) > n);
  }
});

test('optimalWethIn is 0 exactly when no profitable input exists', () => {
  // identical pools: fees make any cycle a guaranteed loss
  assert.equal(optimalWethIn(100n * ETHER, 200_000n * ETHER, 100n * ETHER, 200_000n * ETHER), 0n);
  // clear price gap: must find a positive input
  assert.ok(optimalWethIn(100n * ETHER, 200_000n * ETHER, 100n * ETHER, 190_000n * ETHER) > 0n);
});

test('optimalWethIn maximizes cycle profit (local-maximum property)', () => {
  const rng = makeRng(4n);
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const buyWeth = (rng() % (1000n * ETHER)) + ETHER;
    const buyToken = (rng() % (10n ** 7n * ETHER)) + ETHER;
    const sellWeth = (rng() % (1000n * ETHER)) + ETHER;
    // force a price discrepancy so some cases are profitable
    const sellToken = (rng() % (10n ** 7n * ETHER)) + ETHER;

    const x = optimalWethIn(buyWeth, buyToken, sellWeth, sellToken);
    if (x === 0n) continue;
    checked++;
    const atOpt = cycleProfit(x, buyWeth, buyToken, sellWeth, sellToken);
    assert.ok(atOpt > 0n, 'optimal input must be profitable');
    for (const delta of [x / 100n + 2n, x / 10n + 2n]) {
      const up = cycleProfit(x + delta, buyWeth, buyToken, sellWeth, sellToken);
      assert.ok(atOpt + 2n >= up, `profit(x*) >= profit(x*+${delta})`);
      if (x > delta) {
        const down = cycleProfit(x - delta, buyWeth, buyToken, sellWeth, sellToken);
        assert.ok(atOpt + 2n >= down, `profit(x*) >= profit(x*-${delta})`);
      }
    }
  }
  assert.ok(checked > 20, `expected some profitable samples, got ${checked}`);
});

test('planArbitrage picks the correct direction', () => {
  const poolA = { weth: 100n * ETHER, token: 200_000n * ETHER }; // token cheaper on A
  const poolB = { weth: 100n * ETHER, token: 190_000n * ETHER };

  const plan = planArbitrage(poolA, poolB);
  assert.notEqual(plan, null);
  assert.equal(plan?.buyOnA, true);
  assert.ok((plan?.grossProfit ?? 0n) > 0n);
  assert.ok((plan?.wethOut ?? 0n) === (plan?.wethOwed ?? 0n) + (plan?.grossProfit ?? 0n));

  const flipped = planArbitrage(poolB, poolA);
  assert.equal(flipped?.buyOnA, false);
  // same trade, same economics
  assert.equal(flipped?.grossProfit, plan?.grossProfit);

  assert.equal(planArbitrage(poolA, poolA), null);
});

test('flash-mode repayment stays within a whisker of the ideal input', () => {
  const poolA = { weth: 100n * ETHER, token: 200_000n * ETHER };
  const poolB = { weth: 100n * ETHER, token: 190_000n * ETHER };
  const plan = planArbitrage(poolA, poolB);
  assert.notEqual(plan, null);
  const diff = (plan?.wethOwed ?? 0n) - (plan?.wethIn ?? 0n);
  assert.ok(diff >= -2n && diff <= 2n, `wethOwed ~ wethIn, diff was ${diff}`);
});

test('planDirectionWithInput respects a smaller funded budget', () => {
  const poolA = { weth: 100n * ETHER, token: 200_000n * ETHER };
  const poolB = { weth: 100n * ETHER, token: 190_000n * ETHER };
  const budget = ETHER / 2n; // well under the ~1.12 ETH optimum
  const plan = planDirectionWithInput(poolA, poolB, true, budget);
  assert.notEqual(plan, null);
  assert.equal(plan?.wethIn, budget);
  assert.ok((plan?.grossProfit ?? 0n) > 0n);
});

test('requiredGrossProfit covers gas, bribe and margin', () => {
  assert.equal(requiredGrossProfit(60n, 40n, 0n), 100n);
  // 50% bribe -> need double the gross
  assert.equal(requiredGrossProfit(60n, 40n, 5000n), 200n);
  // ceil division never under-charges
  assert.equal(requiredGrossProfit(1n, 0n, 9999n), 10_000n);
  assert.throws(() => requiredGrossProfit(1n, 1n, 10_000n));
});

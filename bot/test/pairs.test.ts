import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAINNET } from '../src/constants.ts';
import { pairFor, sortTokens } from '../src/pairs.ts';

// Well-known mainnet addresses — these pin our CREATE2 derivation to reality.
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

test('derives the canonical Uniswap V2 USDC/WETH pair', () => {
  assert.equal(
    pairFor(MAINNET.factoryA, MAINNET.initCodeHashA, USDC, MAINNET.weth),
    '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
  );
});

test('derives the canonical Uniswap V2 DAI/WETH pair', () => {
  assert.equal(
    pairFor(MAINNET.factoryA, MAINNET.initCodeHashA, DAI, MAINNET.weth),
    '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11',
  );
});

test('derives the canonical SushiSwap USDC/WETH pair', () => {
  assert.equal(
    pairFor(MAINNET.factoryB, MAINNET.initCodeHashB, USDC, MAINNET.weth),
    '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0',
  );
});

test('pair derivation is argument-order independent', () => {
  assert.equal(
    pairFor(MAINNET.factoryA, MAINNET.initCodeHashA, USDC, MAINNET.weth),
    pairFor(MAINNET.factoryA, MAINNET.initCodeHashA, MAINNET.weth, USDC),
  );
});

test('sortTokens orders numerically like UniswapV2Factory', () => {
  const [t0, t1] = sortTokens(MAINNET.weth, USDC);
  assert.equal(t0, USDC); // 0xA0.. < 0xC0..
  assert.equal(t1, MAINNET.weth);
  assert.throws(() => sortTokens(USDC, USDC));
});

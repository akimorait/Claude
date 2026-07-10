import { readFileSync } from 'node:fs';
import { getAddress, isHexString, parseEther, parseUnits } from 'ethers';
import { MAINNET } from './constants.ts';
import type { LogLevel } from './logger.ts';

export interface TokenEntry {
  symbol: string;
  address: string;
  decimals: number;
}

export interface Config {
  rpcUrl: string;
  chainId: bigint;
  /** Executor hot key. Absent only in dry-run mode. */
  privateKey: string | null;
  /** Deployed FlashArbitrage contract. Absent only in dry-run mode. */
  contractAddress: string | null;
  mode: 'flash' | 'funded';
  dryRun: boolean;
  submit: 'flashbots' | 'public';
  flashbotsRelay: string;
  /** Identity key for Flashbots reputation; falls back to privateKey. */
  flashbotsSignerKey: string | null;
  minNetProfitWei: bigint;
  bribeBps: bigint;
  priorityFeeWei: bigint;
  gasUnitsEstimate: bigint;
  gasLimit: bigint;
  deadlineBlocks: number;
  simulate: boolean;
  pollIntervalMs: number;
  logLevel: LogLevel;
  weth: string;
  factoryA: string;
  initCodeHashA: string;
  factoryB: string;
  initCodeHashB: string;
  multicall3: string;
  tokens: TokenEntry[];
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  if (!['true', 'false', '1', '0'].includes(v.toLowerCase())) {
    throw new Error(`${name} must be true/false`);
  }
  return v.toLowerCase() === 'true' || v === '1';
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const v = env(name);
  const n = v === undefined ? fallback : Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function envChoice<T extends string>(name: string, choices: readonly T[], fallback: T): T {
  const v = env(name) as T | undefined;
  if (v === undefined) return fallback;
  if (!choices.includes(v)) throw new Error(`${name} must be one of: ${choices.join(', ')}`);
  return v;
}

function envAddress(name: string, fallback: string): string {
  const v = env(name) ?? fallback;
  try {
    return getAddress(v);
  } catch {
    throw new Error(`${name} is not a valid address: ${v}`);
  }
}

function envHash(name: string, fallback: string): string {
  const v = env(name) ?? fallback;
  if (!isHexString(v, 32)) throw new Error(`${name} must be a 32-byte hex string`);
  return v;
}

function envKey(name: string): string | null {
  const v = env(name);
  if (v === undefined) return null;
  const key = v.startsWith('0x') ? v : `0x${v}`;
  if (!isHexString(key, 32)) throw new Error(`${name} must be a 32-byte hex private key`);
  return key;
}

function loadTokens(path: string, weth: string): TokenEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `cannot read tokens file "${path}" — copy tokens.example.json to tokens.json`,
    );
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('tokens file must be a non-empty JSON array');
  }
  const seen = new Set<string>();
  const tokens: TokenEntry[] = [];
  for (const item of parsed) {
    const { symbol, address, decimals } = item as Partial<TokenEntry>;
    if (typeof symbol !== 'string' || typeof address !== 'string') {
      throw new Error('each token needs {symbol, address, decimals}');
    }
    const checksummed = getAddress(address);
    if (checksummed === weth) throw new Error(`${symbol}: WETH itself cannot be watched`);
    if (seen.has(checksummed)) continue;
    seen.add(checksummed);
    tokens.push({
      symbol,
      address: checksummed,
      decimals: typeof decimals === 'number' ? decimals : 18,
    });
  }
  return tokens;
}

export function loadConfig(): Config {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* .env is optional; real env vars still apply */
  }

  const rpcUrl = env('RPC_URL');
  if (rpcUrl === undefined) throw new Error('RPC_URL is required (wss:// or https://)');

  const dryRun = envBool('DRY_RUN', true);
  const privateKey = envKey('PRIVATE_KEY');
  const contractRaw = env('CONTRACT_ADDRESS');
  if (!dryRun && privateKey === null) throw new Error('PRIVATE_KEY is required when DRY_RUN=false');
  if (!dryRun && contractRaw === undefined) {
    throw new Error('CONTRACT_ADDRESS is required when DRY_RUN=false');
  }

  const bribeBps = BigInt(envInt('BRIBE_BPS', 5000, 0, 9999));
  const weth = envAddress('WETH_ADDRESS', MAINNET.weth);

  const cfg: Config = {
    rpcUrl,
    chainId: BigInt(envInt('CHAIN_ID', 1, 1, 2 ** 31)),
    privateKey,
    contractAddress: contractRaw === undefined ? null : getAddress(contractRaw),
    mode: envChoice('MODE', ['flash', 'funded'] as const, 'flash'),
    dryRun,
    submit: envChoice('SUBMIT', ['flashbots', 'public'] as const, 'flashbots'),
    flashbotsRelay: env('FLASHBOTS_RELAY') ?? MAINNET.flashbotsRelay,
    flashbotsSignerKey: envKey('FLASHBOTS_SIGNER_KEY'),
    minNetProfitWei: parseEther(env('MIN_NET_PROFIT_ETH') ?? '0.005'),
    bribeBps,
    priorityFeeWei: parseUnits(env('PRIORITY_FEE_GWEI') ?? '2', 'gwei'),
    gasUnitsEstimate: BigInt(envInt('GAS_UNITS_ESTIMATE', 220_000, 50_000, 2_000_000)),
    gasLimit: BigInt(envInt('GAS_LIMIT', 350_000, 100_000, 5_000_000)),
    deadlineBlocks: envInt('DEADLINE_BLOCKS', 2, 1, 100),
    simulate: envBool('SIMULATE', true),
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 1000, 100, 60_000),
    logLevel: envChoice('LOG_LEVEL', ['error', 'warn', 'info', 'debug'] as const, 'info'),
    weth,
    factoryA: envAddress('FACTORY_A', MAINNET.factoryA),
    initCodeHashA: envHash('INIT_CODE_HASH_A', MAINNET.initCodeHashA),
    factoryB: envAddress('FACTORY_B', MAINNET.factoryB),
    initCodeHashB: envHash('INIT_CODE_HASH_B', MAINNET.initCodeHashB),
    multicall3: envAddress('MULTICALL3_ADDRESS', MAINNET.multicall3),
    tokens: loadTokens(env('TOKENS_FILE') ?? 'tokens.json', weth),
  };

  if (cfg.gasLimit < cfg.gasUnitsEstimate) {
    throw new Error('GAS_LIMIT must be >= GAS_UNITS_ESTIMATE');
  }
  return cfg;
}

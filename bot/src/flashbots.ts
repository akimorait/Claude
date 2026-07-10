import { id, toQuantity, type Signer } from 'ethers';

/**
 * Minimal Flashbots Protect client (eth_sendPrivateTransaction).
 *
 * Private submission is the bot's main MEV defense: the transaction never
 * enters the public mempool, so it cannot be observed, copied or front-run
 * before inclusion, and transactions that would revert are simply not
 * included (no gas burned on missed opportunities).
 */

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: JsonRpcError;
}

async function callRelay(
  relayUrl: string,
  authSigner: Signer,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  // Flashbots authentication: keccak256 hash of the body, signed as a message.
  const signature = `${await authSigner.getAddress()}:${await authSigner.signMessage(id(body))}`;
  const res = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Flashbots-Signature': signature },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`relay HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as JsonRpcResponse;
  if (json.error) throw new Error(`relay error ${json.error.code}: ${json.error.message}`);
  return json.result;
}

/**
 * Submit a signed raw transaction privately. The relay keeps trying to include
 * it every block until `maxBlockNumber`, after which it expires harmlessly.
 * Returns the tx hash.
 */
export async function sendPrivateTransaction(
  relayUrl: string,
  authSigner: Signer,
  signedTx: string,
  maxBlockNumber: number,
): Promise<string> {
  const result = await callRelay(relayUrl, authSigner, 'eth_sendPrivateTransaction', [
    {
      tx: signedTx,
      maxBlockNumber: toQuantity(maxBlockNumber),
      preferences: { fast: true },
    },
  ]);
  return result as string;
}

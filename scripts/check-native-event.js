import fs from 'node:fs/promises';
import { matchNativeTransfer } from '../src/core.js';
const rpc = 'https://rpc.mainnet.arc.io';
const call = async (method, params) => {
  if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'].includes(method)) throw Error('Read only');
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const payload = await response.json(); if (payload.error) throw Error(payload.error.message); return payload.result;
};
const evidence = { checkedAtUtc: new Date().toISOString(), rpc, purpose: 'Read-only compatibility check on a third-party public transaction, never user income', verifiedUserIncomeU: 0, writesPerformed: false };
try {
  if (BigInt(await call('eth_chainId', [])) !== 5042n) throw Error('Chain mismatch');
  const block = await call('eth_getBlockByNumber', ['finalized', true]);
  const tx = block.transactions.find(tx => tx.to && BigInt(tx.value) > 0n && tx.from.toLowerCase() !== tx.to.toLowerCase());
  if (!tx) evidence.status = 'No native-value transaction in the sampled block; no claim made.';
  else {
    const receipt = await call('eth_getTransactionReceipt', [tx.hash]);
    evidence.transactionHash = tx.hash; evidence.blockNumber = receipt.blockNumber;
    evidence.receiptSuccess = receipt.status === '0x1';
    evidence.nativeSystemEventMatched = matchNativeTransfer(receipt, { from: tx.from, to: tx.to, amountUnits: tx.value });
    evidence.status = evidence.receiptSuccess && evidence.nativeSystemEventMatched ? 'Public Arc native event format confirmed against RPC.' : 'Native event match not confirmed.';
  }
} catch (e) { evidence.status = 'Check failed'; evidence.error = e.message; }
await fs.writeFile('evidence/public-native-event-check.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));

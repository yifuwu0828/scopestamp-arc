import { AbiCoder, Interface, getAddress, keccak256, parseUnits, toUtf8Bytes } from 'ethers';
import { REGISTRY_RUNTIME_HASH } from './registry.js';

export const NETWORKS = Object.freeze({
  5042: { name: 'Arc Mainnet', rpc: 'https://rpc.mainnet.arc.io', testnet: false },
  5042002: { name: 'Arc Testnet', rpc: 'https://rpc.testnet.arc.io', testnet: true }
});
export const ABI = [
  'function anchor(address recipient,uint256 amount,bytes32 scopeHash,bytes32 nonceHash) returns(bytes32)',
  'function invoices(bytes32) view returns(address issuer,address recipient,uint256 amount,bytes32 scopeHash,bytes32 nonceHash,uint64 anchoredAt)'
];
export const USDC_SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
const transferIface = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const iface = new Interface(ABI);
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

export function matchNativeTransfer(receipt, { from, to, amountUnits }) {
  const payer = getAddress(from), recipient = getAddress(to);
  const matches = (receipt.logs || []).filter(log => {
    if (log.removed || log.address?.toLowerCase() !== USDC_SYSTEM_EMITTER) return false;
    if (log.transactionHash && log.transactionHash.toLowerCase() !== receipt.transactionHash.toLowerCase()) return false;
    if (log.blockHash && log.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) return false;
    try {
      const parsed = transferIface.parseLog(log);
      return parsed && parsed.args.from === payer && parsed.args.to === recipient && parsed.args.value === BigInt(amountUnits);
    } catch { return false; }
  });
  return matches.length === 1;
}

export function createDraft({ recipient, amount, scope, nonce }) {
  const recipientAddress = getAddress(recipient.trim());
  if (recipientAddress === '0x0000000000000000000000000000000000000000') throw Error('Recipient cannot be zero.');
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw Error('Use a plain USDC amount with at most 18 decimals.');
  const units = parseUnits(amount, 18);
  if (units <= 0n || units >= 2n ** 256n) throw Error('Amount must be positive and fit uint256.');
  if (typeof scope !== 'string' || !scope.trim()) throw Error('Enter the agreed scope.');
  const canonicalScope = scope.replace(/\r\n?/g, '\n').trim();
  if (toUtf8Bytes(canonicalScope).length > 8192) throw Error('Scope exceeds 8192 UTF-8 bytes.');
  if (typeof nonce !== 'string' || !nonce.trim() || toUtf8Bytes(nonce.trim()).length > 128) throw Error('Use a unique invoice reference of 1 to 128 UTF-8 bytes.');
  const cleanNonce = nonce.trim();
  const scopeHash = keccak256(toUtf8Bytes(canonicalScope));
  const nonceHash = keccak256(toUtf8Bytes(cleanNonce));
  const id = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'bytes32'], [recipientAddress, units, scopeHash, nonceHash]
  ));
  return { id, recipient: recipientAddress, amount, amountUnits: units.toString(), scopeHash, nonceHash, nonce: cleanNonce, canonicalScope };
}

function checkInvoice(invoice) {
  const expected = createDraft({ ...invoice, scope: invoice.canonicalScope });
  for (const field of ['id', 'recipient', 'amountUnits', 'scopeHash', 'nonceHash']) {
    if (expected[field] !== invoice[field]) throw Error(`Invoice ${field} does not match its content.`);
  }
  return expected;
}

export function exportInvoice(invoice) {
  const expected = checkInvoice(invoice);
  return { schema: 'scopestamp-native-usdc-v1', ...expected,
    paymentMemo: expected.id, paymentDecimals: 18,
    scopeAnchor: 'unverified', paymentVerified: false,
    note: 'Local draft only; neither money received nor deployed invoice proof.' };
}

export function buildAnchorTx({ invoice, registryAddress, chainId }) {
  if (!NETWORKS[chainId]) throw Error('Choose Arc mainnet or testnet.');
  const checked = checkInvoice(invoice);
  const address = getAddress(registryAddress);
  if (address === '0x0000000000000000000000000000000000000000') throw Error('Registry address cannot be zero.');
  return { chainId: Number(chainId), to: address, value: '0x0',
    data: iface.encodeFunctionData('anchor', [checked.recipient, checked.amountUnits, checked.scopeHash, checked.nonceHash]),
    unsigned: true, broadcast: false };
}

export function buildPaymentTx({ invoice, chainId }) {
  if (!NETWORKS[chainId]) throw Error('Choose Arc mainnet or testnet.');
  const checked = checkInvoice(invoice);
  return { chainId: Number(chainId), to: checked.recipient,
    value: '0x' + BigInt(checked.amountUnits).toString(16), data: checked.id,
    unsigned: true, broadcast: false,
    note: 'Native USDC, 18 decimals. The invoice ID is mandatory transaction data. No ERC-20 approval.' };
}

export async function rpcCall(rpcUrl, method, params = []) {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw Error('Use HTTPS RPC or loopback for local tests.');
  const allowed = ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'];
  if (!allowed.includes(method)) throw Error('Read-only RPC methods only.');
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`RPC returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw Error(`RPC: ${payload.error.message}`);
  if (!Object.hasOwn(payload, 'result')) throw Error('RPC response lacks result.');
  return payload.result;
}

export async function verifyReceipt({ rpcUrl, invoice, txHash, chainId }) {
  const checked = checkInvoice(invoice);
  if (!NETWORKS[chainId]) throw Error('Unsupported network.');
  if (!hashPattern.test(txHash)) throw Error('Use a 32-byte transaction hash.');
  const rpc = (method, params) => rpcCall(rpcUrl, method, params);
  const observedChain = BigInt(await rpc('eth_chainId', []));
  if (observedChain !== BigInt(chainId)) return { verified: false, reason: 'RPC network differs from the selected network.' };
  const [tx, receipt, finalized] = await Promise.all([
    rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash]),
    rpc('eth_getBlockByNumber', ['finalized', false])
  ]);
  if (!tx || !receipt) return { verified: false, reason: 'Transaction is unknown or not yet mined.' };
  if (!finalized?.number || !finalized.hash) return { verified: false, reason: 'Finality evidence is unavailable.' };
  if (tx.hash?.toLowerCase() !== txHash.toLowerCase() || receipt.transactionHash?.toLowerCase() !== txHash.toLowerCase()) throw Error('RPC transaction identity mismatch.');
  if (tx.chainId && BigInt(tx.chainId) !== BigInt(chainId)) throw Error('Transaction network differs from selected network.');
  if (receipt.from && getAddress(receipt.from) !== getAddress(tx.from)) throw Error('Receipt payer differs from transaction.');
  if (receipt.status !== '0x1') return { verified: false, reason: 'Transaction failed.' };
  if (!receipt.blockNumber || !receipt.blockHash || tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber) throw Error('Inconsistent mined block identity.');
  if (BigInt(receipt.blockNumber) > BigInt(finalized.number)) return { verified: false, reason: 'Transaction is not finalized.' };
  const canonicalBlock = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (canonicalBlock?.hash !== receipt.blockHash) return { verified: false, reason: 'Transaction block is no longer canonical.' };
  if (!tx.to || getAddress(tx.to) !== checked.recipient) return { verified: false, reason: 'Recipient does not match the invoice.' };
  if (receipt.to && getAddress(receipt.to) !== checked.recipient) throw Error('Receipt recipient differs from transaction.');
  if (BigInt(tx.value) !== BigInt(checked.amountUnits)) return { verified: false, reason: 'Native USDC amount does not match (18-decimal units).' };
  if (tx.input?.toLowerCase() !== checked.id.toLowerCase()) return { verified: false, reason: 'Transaction memo does not match this exact invoice.' };
  const code = await rpc('eth_getCode', [checked.recipient, receipt.blockNumber]);
  if (code !== '0x') return { verified: false, reason: 'Contract recipients are outside this prototype\'s supported scope.' };
  if (getAddress(tx.from) === checked.recipient) return { verified: false, reason: 'Self transfers do not establish earned income.' };
  if (!matchNativeTransfer(receipt, { from: tx.from, to: checked.recipient, amountUnits: checked.amountUnits })) {
    return { verified: false, reason: 'Receipt lacks a unique matching Arc native USDC system Transfer (18 decimals).' };
  }
  const result = { verified: true, reason: NETWORKS[chainId].testnet ? 'Matched finalized testnet payment; this is test money.' : 'Matched finalized native USDC payment for the local invoice.',
    testnet: NETWORKS[chainId].testnet, chainId: Number(chainId), txHash, payer: getAddress(tx.from),
    recipient: checked.recipient, amount: checked.amount, invoiceId: checked.id,
    scopeAnchorVerified: false, nativeUsdcTransferVerified: true, incomeClassification: 'requires_external_order_and_payer_attribution',
    finalizedBlockNumber: finalized.number, receiptBlockNumber: receipt.blockNumber };
  if (invoice.registryAddress) {
    const registryAddress = getAddress(invoice.registryAddress);
    const runtime = await rpc('eth_getCode', [registryAddress, receipt.blockNumber]);
    if (runtime === '0x' || keccak256(runtime) !== REGISTRY_RUNTIME_HASH) {
      result.reason += ' Registry code does not match this reviewed build; scope anchor is unverified.';
      return result;
    }
    const data = await rpc('eth_call', [{ to: registryAddress, data: iface.encodeFunctionData('invoices', [checked.id]) }, receipt.blockNumber]);
    const [issuer, recipient, amount, scopeHash, nonceHash, anchoredAt] = iface.decodeFunctionResult('invoices', data);
    result.scopeAnchorVerified = issuer === checked.recipient
      && recipient === checked.recipient && amount === BigInt(checked.amountUnits)
      && scopeHash === checked.scopeHash && nonceHash === checked.nonceHash && anchoredAt > 0n;
    result.anchorIssuer = issuer;
    if (!result.scopeAnchorVerified) result.reason += ' On-chain scope anchor did not match.';
  }
  return result;
}

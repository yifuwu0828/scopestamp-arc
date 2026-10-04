import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { Interface } from 'ethers';
import { createDraft, exportInvoice, buildAnchorTx, buildPaymentTx, verifyReceipt, rpcCall, ABI, USDC_SYSTEM_EMITTER } from '../src/core.js';

const recipient = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const registry = '0x3333333333333333333333333333333333333333';
const txHash = '0x' + 'aa'.repeat(32);
const blockHash = '0x' + 'bb'.repeat(32);
const invoice = createDraft({ recipient, amount: '1.25', scope: 'One reviewed 24-second sample, one revision.', nonce: 'test-001' });
const artifact = JSON.parse(await fs.readFile(new URL('../build/ScopeStamp.json', import.meta.url), 'utf8'));
const iface = new Interface(ABI);
const eventIface = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const transfer = eventIface.encodeEventLog(eventIface.getEvent('Transfer'), [payer, recipient, invoice.amountUnits]);

function fixture() {
  return {
    chain: '0x4cef52', // 5042002; local fixtures are not public-network receipts.
    tx: { hash: txHash, chainId: '0x4cef52', from: payer, to: recipient, value: '0x' + BigInt(invoice.amountUnits).toString(16), input: invoice.id, blockNumber: '0x10', blockHash },
    receipt: { transactionHash: txHash, from: payer, to: recipient, status: '0x1', blockNumber: '0x10', blockHash, logs: [{ address: USDC_SYSTEM_EMITTER, ...transfer, transactionHash: txHash, blockHash }] },
    final: { number: '0x11', hash: '0x' + 'cc'.repeat(32) },
    canonical: { number: '0x10', hash: blockHash },
    recipientCode: '0x', registryCode: '0x' + artifact.evm.deployedBytecode.object,
    anchor: iface.encodeFunctionResult('invoices', [recipient, recipient, invoice.amountUnits, invoice.scopeHash, invoice.nonceHash, 1])
  };
}

async function withRpc(f, action) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let input = ''; for await (const part of req) input += part;
    const { id, method, params } = JSON.parse(input); seen.push({ method, params });
    let result;
    if (method === 'eth_chainId') result = f.chain;
    else if (method === 'eth_getTransactionByHash') result = f.tx;
    else if (method === 'eth_getTransactionReceipt') result = f.receipt;
    else if (method === 'eth_getBlockByNumber') result = params[0] === 'finalized' ? f.final : f.canonical;
    else if (method === 'eth_getCode') result = params[0].toLowerCase() === registry.toLowerCase() ? f.registryCode : f.recipientCode;
    else if (method === 'eth_call') result = f.anchor;
    else throw Error('Unexpected RPC method');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await action(`http://127.0.0.1:${server.address().port}`, seen); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('canonical scope, amount and reference bind the invoice; exported drafts contain no receipt claim', () => {
  const same = createDraft({ recipient, amount: '1.250', scope: '  One reviewed 24-second sample, one revision.\r\n', nonce: 'test-001' });
  assert.equal(same.id, invoice.id);
  assert.equal(invoice.amountUnits, '1250000000000000000');
  assert.equal(exportInvoice(invoice).paymentVerified, false);
  assert.notEqual(createDraft({ ...invoice, scope: 'Different deliverable' }).id, invoice.id);
  assert.throws(() => exportInvoice({ ...invoice, amountUnits: '1250000' }), /does not match/);
});

test('malformed/zero amounts and invalid or oversized scope/reference are rejected', () => {
  for (const amount of ['0', '-1', '1e6', '01', '0.0000000000000000001', '1,000', 'NaN']) {
    assert.throws(() => createDraft({ recipient, amount, scope: 'A', nonce: 'B' }));
  }
  for (const [scope, nonce] of [['', 'A'], ['A'.repeat(8193), 'A'], ['A', 'B'.repeat(129)]]) {
    assert.throws(() => createDraft({ recipient, amount: '1', scope, nonce }));
  }
});

test('unsigned payloads use zero-value metadata anchoring and 18-decimal direct USDC payment', () => {
  const anchor = buildAnchorTx({ invoice, registryAddress: registry, chainId: 5042002 });
  assert.equal(anchor.value, '0x0'); assert.equal(anchor.broadcast, false);
  assert.equal(iface.parseTransaction(anchor).args[1], 1250000000000000000n);
  const payment = buildPaymentTx({ invoice, chainId: 5042002 });
  assert.equal(BigInt(payment.value), 1250000000000000000n);
  assert.equal(payment.data, invoice.id); assert.equal(payment.to, recipient);
  assert.throws(() => buildPaymentTx({ invoice, chainId: 8453 }), /Choose Arc/);
});

test('matching finalized native USDC payment is classified as test money, not earned revenue', async () => {
  await withRpc(fixture(), async (rpcUrl, seen) => {
    const result = await verifyReceipt({ rpcUrl, invoice, txHash, chainId: 5042002 });
    assert.equal(result.verified, true); assert.equal(result.testnet, true);
    assert.equal(result.scopeAnchorVerified, false);
    assert.equal(result.incomeClassification, 'requires_external_order_and_payer_attribution');
    assert.ok(seen.every(x => !x.method.startsWith('eth_send')));
  });
});

test('wrong network, failed/pending/unfinalized/reorged receipts are rejected', async t => {
  const cases = [
    ['network', f => { f.chain = '0x2105'; }, /network/],
    ['failure', f => { f.receipt.status = '0x0'; }, /failed/],
    ['pending', f => { f.receipt = null; }, /not yet mined/],
    ['no finality', f => { f.final = null; }, /Finality/],
    ['not finalized', f => { f.final.number = '0xf'; }, /not finalized/],
    ['reorg', f => { f.canonical.hash = '0x' + 'dd'.repeat(32); }, /canonical/]
  ];
  for (const [name, mutate, reason] of cases) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await withRpc(f, async rpcUrl => { const r = await verifyReceipt({ rpcUrl, invoice, txHash, chainId: 5042002 }); assert.equal(r.verified, false); assert.match(r.reason, reason); });
  });
});

test('wrong recipient, six-decimal amount, missing memo, contract recipient and self transfer are rejected', async t => {
  const cases = [
    ['recipient', f => { f.tx.to = payer; }, /Recipient/],
    ['wrong decimals', f => { f.tx.value = '0x' + (1250000n).toString(16); }, /18-decimal/],
    ['missing memo', f => { f.tx.input = '0x'; }, /memo/],
    ['contract recipient', f => { f.recipientCode = '0x6000'; }, /Contract recipients/],
    ['self transfer', f => { f.tx.from = recipient; f.receipt.from = recipient; }, /Self transfers/]
  ];
  for (const [name, mutate, reason] of cases) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await withRpc(f, async rpcUrl => { const r = await verifyReceipt({ rpcUrl, invoice, txHash, chainId: 5042002 }); assert.equal(r.verified, false); assert.match(r.reason, reason); });
  });
});

test('contradictory transaction/receipt identities raise errors rather than verified results', async t => {
  for (const [name, mutate] of [
    ['hash', f => { f.tx.hash = '0x' + 'ff'.repeat(32); }],
    ['block', f => { f.tx.blockHash = '0x' + 'ff'.repeat(32); }],
    ['chain', f => { f.tx.chainId = '0x2105'; }],
    ['payer', f => { f.receipt.from = recipient; }]
  ]) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await withRpc(f, rpcUrl => assert.rejects(verifyReceipt({ rpcUrl, invoice, txHash, chainId: 5042002 })));
  });
});

test('scope proof requires matching compiled registry code, recipient issuer and fields', async t => {
  for (const [name, mutate, expected] of [
    ['matching registry', () => {}, true],
    ['unknown code', f => { f.registryCode = '0x6000'; }, false],
    ['absent code', f => { f.registryCode = '0x'; }, false],
    ['wrong scope', f => { f.anchor = iface.encodeFunctionResult('invoices', [recipient, recipient, invoice.amountUnits, txHash, invoice.nonceHash, 1]); }, false],
    ['wrong issuer', f => { f.anchor = iface.encodeFunctionResult('invoices', [payer, recipient, invoice.amountUnits, invoice.scopeHash, invoice.nonceHash, 1]); }, false]
  ]) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await withRpc(f, async rpcUrl => {
      const r = await verifyReceipt({ rpcUrl, invoice: { ...invoice, registryAddress: registry }, txHash, chainId: 5042002 });
      assert.equal(r.verified, true); assert.equal(r.scopeAnchorVerified, expected);
    });
  });
});

test('browser RPC helper cannot broadcast or use arbitrary insecure RPC hosts', async () => {
  await assert.rejects(rpcCall('https://rpc.mainnet.arc.io', 'eth_sendRawTransaction', ['0x']), /Read-only/);
  await assert.rejects(rpcCall('http://example.com', 'eth_chainId'), /HTTPS/);
});

test('Arc native proof rejects absent, wrong-emitter, six-decimal, removed and duplicate logs', async t => {
  for (const [name, mutate] of [
    ['no logs', f => { f.receipt.logs = []; }],
    ['ERC-20 emitter', f => { f.receipt.logs[0].address = '0x3600000000000000000000000000000000000000'; }],
    ['six decimals', f => { Object.assign(f.receipt.logs[0], eventIface.encodeEventLog(eventIface.getEvent('Transfer'), [payer, recipient, 1250000n])); }],
    ['removed log', f => { f.receipt.logs[0].removed = true; }],
    ['duplicate log', f => { f.receipt.logs.push({ ...f.receipt.logs[0] }); }]
  ]) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    await withRpc(f, async rpcUrl => { const r = await verifyReceipt({ rpcUrl, invoice, txHash, chainId: 5042002 }); assert.equal(r.verified, false); assert.match(r.reason, /system Transfer/); });
  });
});

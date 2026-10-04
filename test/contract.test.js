import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ganache from 'ganache';
import { JsonRpcProvider, ContractFactory } from 'ethers';
import { createDraft, buildAnchorTx, buildPaymentTx, verifyReceipt } from '../src/core.js';

test('standard local EVM: contract/payment work; missing Arc system event prevents an Arc receipt claim', async () => {
  const server = ganache.server({ logging: { quiet: true }, chain: { chainId: 5042002, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 3 } });
  await server.listen(0, '127.0.0.1');
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  const provider = new JsonRpcProvider(rpcUrl); provider.pollingInterval = 50;
  try {
    const recipientSigner = await provider.getSigner(0);
    const payerSigner = await provider.getSigner(1);
    const recipient = await recipientSigner.getAddress();
    const artifact = JSON.parse(await fs.readFile(new URL('../build/ScopeStamp.json', import.meta.url), 'utf8'));
    const registry = await new ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, recipientSigner).deploy();
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    const invoice = createDraft({ recipient, amount: '1.25', scope: 'Local simulated sample milestone.', nonce: 'local-only-001' });
    await assert.rejects(registry.connect(payerSigner).anchor(recipient, invoice.amountUnits, invoice.scopeHash, invoice.nonceHash), /revert|missing revert/);
    const anchor = buildAnchorTx({ invoice, registryAddress, chainId: 5042002 });
    const { unsigned, broadcast, ...anchorFields } = anchor;
    await (await recipientSigner.sendTransaction(anchorFields)).wait();
    const recorded = await registry.invoices(invoice.id);
    assert.equal(recorded.issuer, recipient); assert.equal(recorded.scopeHash, invoice.scopeHash);
    await assert.rejects(registry.anchor(recipient, invoice.amountUnits, invoice.scopeHash, invoice.nonceHash), /revert|missing revert/);
    await assert.rejects(payerSigner.sendTransaction({ to: registryAddress, value: 1n }), /revert|missing revert/);
    const { unsigned: u, broadcast: b, note, ...payment } = buildPaymentTx({ invoice, chainId: 5042002 });
    const settled = await payerSigner.sendTransaction(payment); await settled.wait();
    const result = await verifyReceipt({ rpcUrl, invoice: { ...invoice, registryAddress }, txHash: settled.hash, chainId: 5042002 });
    assert.equal(result.verified, false); assert.match(result.reason, /system Transfer/);
    assert.equal(await provider.getBalance(registryAddress), 0n);
    const mined = await provider.getTransactionReceipt(settled.hash);
    assert.equal(mined.status, 1);
    // Ganache's finalized tag is a local simulation, never evidence of real Arc finality or income.
    await fs.mkdir('evidence', { recursive: true });
    await fs.writeFile('evidence/local-evm-simulation.json', JSON.stringify({ environment: 'isolated Ganache, synthetic accounts and funds; not Arc mainnet or testnet', standardEvmContractAndPaymentPassed: true, arcSpecificSystemEventAbsent: true, verifiedIncomeU: 0, deploymentGasUsed: (await registry.deploymentTransaction().wait()).gasUsed.toString(), result }, null, 2));
  } finally { provider.destroy(); await server.close(); }
});

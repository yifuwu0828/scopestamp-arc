import fs from 'node:fs/promises';
import { formatUnits } from 'ethers';

const artifact = JSON.parse(await fs.readFile('build/ScopeStamp.json', 'utf8'));
const results = [];
for (const network of [
  { name: 'Arc Mainnet', chainId: 5042, rpc: 'https://rpc.mainnet.arc.io' },
  { name: 'Arc Testnet', chainId: 5042002, rpc: 'https://rpc.testnet.arc.io' }
]) {
  const evidence = { ...network, checkedAtUtc: new Date().toISOString(), writesPerformed: false };
  const call = async (method, params = []) => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_estimateGas'].includes(method)) throw Error('Read only');
    const r = await fetch(network.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    const data = await r.json(); if (data.error) throw Error(JSON.stringify(data.error)); return data.result;
  };
  try {
    const id = await call('eth_chainId'); evidence.observedChainId = Number(BigInt(id));
    if (evidence.observedChainId !== network.chainId) throw Error('Chain mismatch');
    const values = await Promise.allSettled([
      call('eth_getBlockByNumber', ['finalized', false]), call('eth_gasPrice'),
      call('eth_estimateGas', [{ data: '0x' + artifact.evm.bytecode.object, value: '0x0' }])
    ]);
    for (const [i, key] of ['finalizedBlock', 'gasPrice', 'deploymentGasEstimate'].entries()) {
      if (values[i].status === 'fulfilled') evidence[key] = values[i].value;
      else evidence[key + 'Error'] = values[i].reason.message;
    }
    if (evidence.gasPrice && evidence.deploymentGasEstimate) {
      evidence.deploymentFeeSnapshotUsdc = formatUnits(BigInt(evidence.gasPrice) * BigInt(evidence.deploymentGasEstimate), 18);
      evidence.costCaveat = 'Snapshot estimate only; no transaction sent. Wallet-specific estimate and funding route still required.';
    }
    evidence.reachable = true;
  } catch (e) { evidence.reachable = false; evidence.error = `${e.message}${e.cause?.message ? ': ' + e.cause.message : ''}`; }
  results.push(evidence);
}
await fs.mkdir('evidence', { recursive: true });
await fs.writeFile('evidence/public-rpc-check.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

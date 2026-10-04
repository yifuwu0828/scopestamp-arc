import fs from 'node:fs/promises';
import { formatUnits, keccak256 } from 'ethers';
const artifact = JSON.parse(await fs.readFile('build/ScopeStamp.json', 'utf8'));
const evidence = JSON.parse(await fs.readFile('evidence/public-rpc-check.json', 'utf8')).find(n => n.chainId === 5042);
if (!evidence?.reachable || evidence.observedChainId !== 5042 || !evidence.deploymentGasEstimate || !evidence.gasPrice) throw Error('A valid official mainnet RPC cost snapshot is required.');
const gasLimit = (BigInt(evidence.deploymentGasEstimate) * 120n + 99n) / 100n;
const price = BigInt(evidence.gasPrice);
const maxFee = (price < 20000000000n ? 20000000000n : price) * 2n;
const tx = { type: '0x2', chainId: '0x13b2', value: '0x0', data: '0x' + artifact.evm.bytecode.object,
  gas: '0x' + gasLimit.toString(16), maxFeePerGas: '0x' + maxFee.toString(16), maxPriorityFeePerGas: '0x0' };
await fs.writeFile('evidence/unsigned-deployment-mainnet.json', JSON.stringify({ preparedAtUtc: new Date().toISOString(), unsigned: true, broadcast: false, network: 'Arc Mainnet', transaction: tx,
  runtimeKeccak256: keccak256('0x' + artifact.evm.deployedBytecode.object),
  feeSnapshotAtUtc: evidence.checkedAtUtc, estimatedDeploymentFeeUsdc: evidence.deploymentFeeSnapshotUsdc,
  maxDeploymentFeeAtThisGasLimitUsdc: formatUnits(gasLimit * maxFee, 18),
  fundingAndBridgeCostsIncluded: false, capitalBudgetApproved: false,
  requiredAction: 'Human must first approve funding, verify the intended Arc address and fresh fee estimate, then personally approve any wallet transaction. No key import or broadcasting script exists.' }, null, 2));
console.log(JSON.stringify({ unsigned: true, broadcast: false, gasLimit: gasLimit.toString(), maxDeploymentFeeUsdc: formatUnits(gasLimit * maxFee, 18) }));

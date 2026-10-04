import {
  createDraft,
  verifyReceipt,
  buildAnchorTx,
  exportInvoice,
  buildPaymentTx
} from '../src/core.js';

// Application state
let activeInvoice = null;
let activeAnchorPayload = null;
let inFlightVerificationId = 0;

// Network configuration
const NETWORK_CONFIG = {
  '5042': {
    chainId: 5042,
    rpcUrl: 'https://rpc.mainnet.arc.io',
    name: 'Arc Mainnet (5042)'
  },
  '5042002': {
    chainId: 5042002,
    rpcUrl: 'https://rpc.testnet.arc.io',
    name: 'Arc Testnet (5042002)'
  }
};

// DOM references
const draftForm = document.getElementById('draft-form');
const recipientInput = document.getElementById('recipient-input');
const amountInput = document.getElementById('amount-input');
const nonceInput = document.getElementById('nonce-input');
const scopeInput = document.getElementById('scope-input');
const draftError = document.getElementById('draft-error');
const draftOutput = document.getElementById('draft-output');

const outInvoiceId = document.getElementById('out-invoice-id');
const outScopeDigest = document.getElementById('out-scope-digest');
const outRecipient = document.getElementById('out-recipient');
const outAmount = document.getElementById('out-amount');
const outAmountUnits = document.getElementById('out-amount-units');

const btnCopyInvoice = document.getElementById('btn-copy-invoice');
const btnDownloadInvoice = document.getElementById('btn-download-invoice');
const draftActionFeedback = document.getElementById('draft-action-feedback');

const networkSelect = document.getElementById('network-select');
const txHashInput = document.getElementById('tx-hash-input');
const btnVerify = document.getElementById('btn-verify');
const verifyBadge = document.getElementById('verify-badge');
const verifyOutput = document.getElementById('verify-output');
const verifyLockHint = document.getElementById('verify-lock-hint');

const registryAddressInput = document.getElementById('registry-address-input');
const btnBuildAnchor = document.getElementById('btn-build-anchor');
const anchorOutputContainer = document.getElementById('anchor-output-container');
const anchorJsonCode = document.getElementById('anchor-json-code');
const btnCopyAnchor = document.getElementById('btn-copy-anchor');
const btnDownloadAnchor = document.getElementById('btn-download-anchor');
const anchorActionFeedback = document.getElementById('anchor-action-feedback');

// Helper: Get currently selected network definition
function getSelectedNetwork() {
  const key = networkSelect.value;
  return NETWORK_CONFIG[key] || {
    chainId: Number(key),
    rpcUrl: networkSelect.selectedOptions[0]?.dataset?.rpc || '',
    name: 'Unknown Network'
  };
}

// Helper: Amount format validation (max 18 decimals, plain string)
function isValidAmountString(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  // Match standard unsigned decimal format, max 18 decimal places
  return /^(?:0|[1-9]\d*)(\.\d{1,18})?$/.test(trimmed);
}

// Helper: Address format validation
function isValidAddress(val) {
  if (typeof val !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(val.trim());
}

// Helper: Safe clipboard copy
async function copyToClipboard(text, feedbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    feedbackEl.textContent = 'Copied to clipboard.';
    setTimeout(() => {
      feedbackEl.textContent = '';
    }, 2500);
  } catch {
    feedbackEl.textContent = 'Copy failed. Please copy manually from the field.';
  }
}

// Helper: Local file download
function triggerLocalJsonDownload(filename, data) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Helper: Format verification details safely as text
function formatVerificationDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const lines = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === 'verified' || key === 'reason') continue;
    const formattedVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    lines.push(`${key}: ${formattedVal}`);
  }
  return lines.length ? `\nDetails:\n${lines.join('\n')}` : '';
}

// Invalidate prior verification immediately
function invalidateVerification(reasonText) {
  inFlightVerificationId++;
  verifyBadge.textContent = 'Awaiting Verification';
  verifyBadge.className = 'badge-neutral';
  verifyOutput.textContent = reasonText || 'Verification invalidated. Run verification again.';
}

// Invalidate prior anchor immediately
function invalidateAnchor() {
  activeAnchorPayload = null;
  anchorJsonCode.textContent = '';
  anchorOutputContainer.classList.add('hidden');
}

// 1. Create Invoice Draft Handler
draftForm.addEventListener('submit', (e) => {
  e.preventDefault();

  draftError.classList.add('hidden');
  draftError.textContent = '';

  const recipient = recipientInput.value.trim();
  const amount = amountInput.value.trim();
  const scope = scopeInput.value;
  const nonce = nonceInput.value.trim();

  // Validate form inputs
  if (!recipient || !isValidAddress(recipient)) {
    draftError.textContent = 'Recipient must be a valid 20-byte hex address (0x...).';
    draftError.classList.remove('hidden');
    return;
  }

  if (!amount || !isValidAmountString(amount)) {
    draftError.textContent = 'Amount must be a positive plain string with at most 18 decimal places.';
    draftError.classList.remove('hidden');
    return;
  }

  if (!scope || !scope.trim()) {
    draftError.textContent = 'Scope description cannot be blank.';
    draftError.classList.remove('hidden');
    return;
  }

  if (!nonce) {
    draftError.textContent = 'Invoice nonce/reference identifier is required.';
    draftError.classList.remove('hidden');
    return;
  }

  try {
    const draft = createDraft({ recipient, amount, scope, nonce });
    activeInvoice = draft;

    // Display draft results using textContent
    outInvoiceId.textContent = draft.id || 'N/A';
    outScopeDigest.textContent = draft.scopeHash || 'N/A';
    outRecipient.textContent = draft.recipient || recipient;
    outAmount.textContent = `${draft.amount || amount} USDC`;
    outAmountUnits.textContent = draft.amountUnits != null ? String(draft.amountUnits) : 'N/A';

    draftOutput.classList.remove('hidden');

    // Enable downstream actions
    btnVerify.disabled = false;
    btnBuildAnchor.disabled = false;
    verifyLockHint.classList.add('hidden');

    // Invalidate prior verification and anchor results
    invalidateVerification('Active invoice updated. Prior verification invalidated.');
    invalidateAnchor();

  } catch (err) {
    draftError.textContent = `Error creating invoice draft: ${err?.message || String(err)}`;
    draftError.classList.remove('hidden');
  }
});

// Copy & Download Invoice JSON
btnCopyInvoice.addEventListener('click', () => {
  if (!activeInvoice) return;
  try {
    const exported = exportInvoice(activeInvoice);
    exported.unsignedPayment = buildPaymentTx({ invoice: activeInvoice, chainId: getSelectedNetwork().chainId });
    copyToClipboard(JSON.stringify(exported, null, 2), draftActionFeedback);
  } catch (err) {
    draftActionFeedback.textContent = `Export error: ${err?.message || String(err)}`;
  }
});

btnDownloadInvoice.addEventListener('click', () => {
  if (!activeInvoice) return;
  try {
    const exported = exportInvoice(activeInvoice);
    exported.unsignedPayment = buildPaymentTx({ invoice: activeInvoice, chainId: getSelectedNetwork().chainId });
    const filename = `scopestamp-${activeInvoice.id || 'draft'}.json`;
    triggerLocalJsonDownload(filename, exported);
    draftActionFeedback.textContent = 'Download started.';
    setTimeout(() => { draftActionFeedback.textContent = ''; }, 2500);
  } catch (err) {
    draftActionFeedback.textContent = `Export error: ${err?.message || String(err)}`;
  }
});

// 2. Read-Only Receipt Verification Handler
btnVerify.addEventListener('click', async () => {
  if (!activeInvoice) {
    invalidateVerification('No active invoice draft. Please create a draft first.');
    return;
  }

  const txHash = txHashInput.value.trim();
  if (!txHash) {
    verifyBadge.textContent = 'Missing Input';
    verifyBadge.className = 'badge-unverified';
    verifyOutput.textContent = 'Please provide a transaction hash to query on-chain settlement.';
    return;
  }

  const selectedNet = getSelectedNetwork();
  const requestId = ++inFlightVerificationId;
  const lockedInvoice = registryAddressInput.value.trim()
    ? { ...activeInvoice, registryAddress: registryAddressInput.value.trim() } : activeInvoice;
  const sourceInvoice = activeInvoice;
  const lockedChainId = selectedNet.chainId;

  verifyBadge.textContent = 'Pending';
  verifyBadge.className = 'badge-neutral';
  verifyOutput.textContent = `Querying public RPC (${selectedNet.rpcUrl}) on ${selectedNet.name} for transaction ${txHash}...`;

  try {
    const result = await verifyReceipt({
      rpcUrl: selectedNet.rpcUrl,
      invoice: lockedInvoice,
      txHash,
      chainId: lockedChainId
    });

    // Check if response should be discarded due to intervening changes
    if (
      requestId !== inFlightVerificationId ||
      activeInvoice !== sourceInvoice ||
      getSelectedNetwork().chainId !== lockedChainId
    ) {
      return;
    }

    if (result && result.verified) {
      verifyBadge.textContent = 'Payment Matched';
      verifyBadge.className = 'badge-success';
      const reasonMsg = result.reason ? `\nStatus: ${result.reason}` : '\nStatus: On-chain receipt matches invoice terms.';
      verifyOutput.textContent = `Verification Result: Receipt Verified.${reasonMsg}${formatVerificationDetails(result)}`;
    } else {
      verifyBadge.textContent = 'Unverified';
      verifyBadge.className = 'badge-unverified';
      const reasonMsg = result?.reason || 'Transaction does not match invoice criteria.';
      verifyOutput.textContent = `Verification Result: Not Verified.\nReason: ${reasonMsg}${formatVerificationDetails(result)}`;
    }

  } catch (err) {
    if (
      requestId !== inFlightVerificationId ||
      activeInvoice !== sourceInvoice ||
      getSelectedNetwork().chainId !== lockedChainId
    ) {
      return;
    }

    verifyBadge.textContent = 'Error';
    verifyBadge.className = 'badge-error';
    verifyOutput.textContent = `Verification Error: ${err?.message || String(err)}`;
  }
});

// Network selection changes invalidate prior verification and anchor
networkSelect.addEventListener('change', () => {
  invalidateVerification('Target network changed. Prior verification invalidated.');
  invalidateAnchor();
});

// Input alterations in draft fields invalidate verification
[recipientInput, amountInput, scopeInput, nonceInput].forEach((input) => {
  input.addEventListener('input', () => {
    // If values are modified away from the active draft, let user know
    if (activeInvoice) {
      activeInvoice = null;
      draftOutput.classList.add('hidden');
      btnVerify.disabled = true;
      btnBuildAnchor.disabled = true;
      verifyLockHint.classList.remove('hidden');
      invalidateVerification('Draft inputs modified. Re-create draft to verify against new terms.');
      invalidateAnchor();
    }
  });
});

// Transaction hash changes invalidate prior result
txHashInput.addEventListener('input', () => {
  invalidateVerification('Transaction hash changed. Click Verify Receipt to evaluate.');
});

// 3. Prepare Scope Anchor Handler
btnBuildAnchor.addEventListener('click', () => {
  if (!activeInvoice) return;
  invalidateAnchor();

  const registryAddress = registryAddressInput.value.trim();
  if (!registryAddress || !isValidAddress(registryAddress)) {
    anchorOutputContainer.classList.remove('hidden');
    anchorJsonCode.textContent = 'Error: Please provide a valid 20-byte hex address for the registry contract.';
    return;
  }

  const selectedNet = getSelectedNetwork();

  try {
    const tx = buildAnchorTx({
      invoice: activeInvoice,
      registryAddress,
      chainId: selectedNet.chainId
    });

    activeAnchorPayload = tx;
    anchorJsonCode.textContent = JSON.stringify(tx, null, 2);
    anchorOutputContainer.classList.remove('hidden');
    anchorActionFeedback.textContent = '';

  } catch (err) {
    anchorOutputContainer.classList.remove('hidden');
    anchorJsonCode.textContent = `Error building anchor transaction: ${err?.message || String(err)}`;
  }
});

registryAddressInput.addEventListener('input', () => {
  invalidateAnchor();
  invalidateVerification('Registry changed. Re-run verification to check the scope anchor.');
});

// Copy & Download Anchor JSON
btnCopyAnchor.addEventListener('click', () => {
  if (!activeAnchorPayload) return;
  copyToClipboard(JSON.stringify(activeAnchorPayload, null, 2), anchorActionFeedback);
});

btnDownloadAnchor.addEventListener('click', () => {
  if (!activeAnchorPayload) return;
  const filename = `anchor-tx-${activeInvoice?.id || 'unsigned'}.json`;
  triggerLocalJsonDownload(filename, activeAnchorPayload);
  anchorActionFeedback.textContent = 'Download started.';
  setTimeout(() => { anchorActionFeedback.textContent = ''; }, 2500);
});

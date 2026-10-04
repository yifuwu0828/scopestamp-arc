ScopeStamp — local Arc microgrant prototype

Status: locally compiled and tested; NOT deployed, NOT submitted, NO grant awarded.
AI-assisted preparation for Ethan Wu. No fabricated client, paid order or receipt.

Purpose
Freelancers can bind a deliverable description, recipient, USDC amount and unique
invoice reference to an invoice digest. A metadata-only registry records the
digest. Payment goes directly to the recipient, never through the registry.
The app checks a public transaction against exact terms without wallet access.

Run locally (Node 22+)
1. Install dependencies from the pinned package.json / pnpm-lock.yaml using pnpm
   install --ignore-scripts. Do not update dependency versions speculatively.
2. node scripts/build.js
3. node --test test/*.test.js
4. node scripts/serve.js
5. Open http://127.0.0.1:47825

Workflow
Create a local draft with the intended Arc recipient, amount and scope. Export
its JSON. It contains an UNSIGNED direct native USDC payment with the invoice
ID as mandatory transaction data. Ordinary wallet sends with no data will not
match. No function connects a wallet, signs, sends, approves tokens or bridges.

After a reviewed registry is deployed, only the recipient can anchor that exact
invoice from their own account. The generated anchor transaction has value 0.
Enter the registry address to additionally check its runtime against the exact
compiled build and its stored invoice at the payment block. A matching payment
and a matching scope anchor are reported separately.
Anchor the invoice and wait for that transaction to be finalized before paying.
An anchor added after the payment block cannot verify that earlier payment's
scope, even if the current registry now contains the same invoice.

Receipt checks
Correct Arc chain, tx/receipt identity, success status, finalized/canonical
block, exact recipient, exact native USDC value (18 decimals), exact invoice
data and a unique matching native system Transfer from Arc's EIP-7708 emitter
0xfffffffffffffffffffffffffffffffffffffffe. Reject self transfers, contract
recipients, ERC-20-only logs, missing system events and removed/duplicate logs.
Contract recipients and EIP-7702 delegated accounts are outside this prototype.
The ERC-20 USDC 6-decimal interface is not supported by this native-send flow.

Boundaries
Hashing is not encryption. Guessable terms may be inferred from their digest.
Anchors are immutable records with no cancellation, expiry or revocation.
Changing a draft creates a different invoice; it does not revoke an old anchor.
The verifier can check the same receipt repeatedly. An accounting system must
deduplicate by network and transaction hash, and require a unique reference for
each invoice. A verified receipt alone does not prove client income or a new
payment on every recheck.
Exported invoice JSON includes the actual scope; share it only intentionally.
Only hashes and payment metadata are recorded by the contract. RPC verification
discloses public tx/address/block queries, and optional invoice digest lookups.
Matched payment does not establish who commissioned the work or that money
is earned revenue. Test funds, self-funded demonstrations and third-party public
transactions are never credited to the 1000 U goal. A single public RPC is a
trust dependency. No professional security audit or mainnet end-to-end check
has been completed. Ordinary payments to the nonpayable registry revert.

Test evidence
test/receipt.test.js uses explicit synthetic JSON-RPC fixtures.
test/contract.test.js uses an isolated standard Ganache EVM with synthetic
accounts/funds. It tests the actual compiled contract, recipient-only anchoring,
duplicate rejection, nonpayable behavior and memo-bearing native transfers.
Ganache does not reproduce Arc's system Transfer logs; the verifier correctly
refuses to call its receipt an Arc payment. Arc-specific fixtures separately
test that log format. Public native-event evidence is a read-only compatibility
check on someone else's transaction and is not a demo of our deployed app.

Deployment preparation
scripts/check-network.js only queries official mainnet/testnet RPCs and obtains
a fee snapshot for contract creation. It never broadcasts. The Oct 4, 2026
mainnet snapshot estimated 308206 gas at 20 Gwei = 0.00616412 USDC. This excludes
funding/bridge fees, wallet fee settings, an anchor and a demonstration payment.
There is no approved capital budget. No wallet address has been bound to Arc
and no private key, recovery phrase or credential is requested or stored.
Do not deploy from an agent-controlled key. Human wallet confirmation is required.

Grant preparation
Arc Microgrants offers 20 selected projects 500 USDC each. A local-only project
is ineligible: it requires a working Arc mainnet deployment, live link, public
repo and public builder profile. Selection and private payout screening remain
uncertain. Deadline: Oct 14, 2026 23:59 Eastern (Oct 15 06:59 Asia/Riyadh).
All decisions expected by Oct 21; announcement timezone is not specified.
No additional Superteam Earn credit is required by this separate grant program.

Next steps
Review this prototype; verify the intended Arc address/wallet and a funding
quote; approve a specific spending cap; perform wallet funding/signing personally.
Publish a sanitized repo/frontend only after those actions are concrete and
authorized. Verify deployed bytecode, a real anchor, a finalized demo transfer
and exact system log. Label the demo self-funded, not client earnings. Then
prepare and review the actual DoraHacks application before its final terms step.

Primary references (checked Oct 4, 2026)
https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq
https://dorahacks.io/hackathon/arc-microgrants/detail
https://docs.arc.io/arc/references/connect-to-arc
https://docs.arc.io/arc/references/usdc-system-events
https://docs.arc.io/integrate/evm-differences
https://help.phantom.com/articles/41372840389651
https://help.phantom.com/articles/buy-sol-eth-and-other-tokens-in-the-phantom-browser-extension-52630526574227

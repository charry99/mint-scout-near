// Live integration tests for the Mint Scout NEAR check engine.
// These hit real NEAR mainnet RPC endpoints, so they need network.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccount } from '../lib/checker.js';
import { explainCheck, otariAvailable } from '../lib/otari.js';

test('intents.near — NEP-330 metadata published, no full-access keys, VERIFIED', { timeout: 90000 }, async () => {
  const r = await checkAccount('intents.near');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'contract');
  assert.equal(r.facts.sourceMetadataStatus, 'present');
  assert.equal(r.facts.sourceMetadataComplete, true);
  assert.equal(r.facts.fullAccessKeys, 0);
  assert.ok(r.facts.sourceMetadata.link && r.facts.sourceMetadata.link.includes('github.com/near/intents'));
  assert.equal(r.verdict, 'VERIFIED');
});

test('ref-finance.near — no verifiable source, single full-access key, HIGH RISK', { timeout: 90000 }, async () => {
  const r = await checkAccount('ref-finance.near');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'contract');
  // Its old WASM cannot be view-called by current nodes, so no method
  // can be read — metadata is unknown, not merely absent.
  assert.equal(r.facts.viewCallsBroken, true);
  assert.equal(r.facts.fullAccessKeys, 1);
  assert.equal(r.verdict, 'HIGH RISK');
  assert.ok(r.flags.includes('full-access-keys'));
});

test('wrap.near — immutable but no source metadata, NEEDS REVIEW', { timeout: 90000 }, async () => {
  const r = await checkAccount('wrap.near');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'contract');
  assert.equal(r.facts.sourceMetadataStatus, 'absent');
  assert.equal(r.facts.fullAccessKeys, 0);
  assert.equal(r.facts.ft.symbol, 'wNEAR');
  assert.equal(r.facts.ft.decimals, 24);
  assert.ok(r.facts.standards.includes('nep141'));
  assert.equal(r.verdict, 'NEEDS REVIEW');
});

test('usdt.tether-token.near — immutable but no source metadata, NEEDS REVIEW', { timeout: 90000 }, async () => {
  const r = await checkAccount('usdt.tether-token.near');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'contract');
  assert.equal(r.facts.sourceMetadataStatus, 'absent');
  assert.equal(r.facts.fullAccessKeys, 0);
  assert.equal(r.facts.ft.symbol, 'USDt');
  assert.equal(r.verdict, 'NEEDS REVIEW');
});

test('illia.near — plain wallet account, not a contract', { timeout: 90000 }, async () => {
  const r = await checkAccount('illia.near');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'not_contract');
  assert.equal(r.verdict, null);
});

test('nonexistent account — clear error', { timeout: 90000 }, async () => {
  const r = await checkAccount('this-account-definitely-does-not-exist-xyz.near');
  assert.equal(r.ok, false);
  assert.match(r.error, /does not exist/);
});

test('Otari explain — graceful fallback without a token', async () => {
  if (otariAvailable()) {
    // Token present: live call, just check it returns text.
    const r = await explainCheck({ verdict: 'VERIFIED', kind: 'contract', accountId: 'intents.near', checks: [], facts: {}, flags: [], summary: 'test' });
    assert.equal(r.available, true);
    assert.ok(r.text && r.text.length > 20);
  } else {
    const r = await explainCheck({ verdict: 'VERIFIED', kind: 'contract', accountId: 'intents.near', checks: [], facts: {}, flags: [], summary: 'test' });
    assert.equal(r.available, false);
    assert.match(r.reason, /OTARI_AI_TOKEN/);
  }
});

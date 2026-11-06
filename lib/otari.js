// Otari AI client — Mozilla's hosted AI gateway, OpenAI-compatible.
// https://api.otari.ai/v1 — chat completions at POST /v1/chat/completions
// Auth: Bearer token from env OTARI_AI_TOKEN (tokens start with `otk_`).
// No token is hardcoded anywhere; without one the app still works and
// /api/explain returns a graceful fallback.
const OTARI_BASE = process.env.OTARI_BASE_URL || 'https://api.otari.ai/v1';
const DEFAULT_MODEL = process.env.OTARI_MODEL || 'deepseek/deepseek-v4-pro-0813';

export function otariAvailable() {
  return Boolean(process.env.OTARI_AI_TOKEN);
}

function buildPrompt(check) {
  const checks = (check.checks || [])
    .map((c) => `- [${c.status}] ${c.label}: ${c.detail || ''}`)
    .join('\n');
  const facts = check.facts || {};
  const meta = facts.sourceMetadata || null;
  return [
    'You are Mint Scout NEAR, a plain-language explainer for crypto users who are about to interact with a smart contract on NEAR Protocol.',
    'Explain the contract check result below in 3-6 short sentences, in plain English, no jargon.',
    'Cover: what the contract appears to be, the biggest risk or reassurance, and what to double-check before interacting with it.',
    'Use ONLY the facts given. Never invent prices, supplies, audits, or team details. If something is unknown, say so.',
    'Do not give financial advice. If the verdict is not VERIFIED, end with one sentence of caution.',
    '',
    `Verdict: ${check.verdict || 'N/A'} (${check.kind || 'unknown'})`,
    `NEAR account: ${check.accountId}`,
    `Summary: ${check.summary || ''}`,
    `Facts: codeHash=${facts.codeHash || '?'}, sourceMetadata=${facts.sourceMetadataStatus || '?'}${meta && meta.link ? ` (${meta.link})` : ''}, fullAccessKeys=${facts.fullAccessKeys ?? '?'}, standards=${(facts.standards || []).join(', ') || '?'}, token=${facts.ft ? `${facts.ft.name || '?'} (${facts.ft.symbol || '?'})` : facts.nft ? `NFT ${facts.nft.name || '?'}` : '?'}`,
    `Flags: ${(check.flags || []).join(', ') || 'none'}`,
    'Checks:',
    checks,
  ].join('\n');
}

/**
 * Ask Otari to explain a check result.
 * Returns { available, model?, text?, reason? }.
 * Without a token this returns available:false — never an error.
 */
export async function explainCheck(check) {
  const token = process.env.OTARI_AI_TOKEN;
  if (!token) {
    return {
      available: false,
      reason: 'AI explanation unavailable — set OTARI_AI_TOKEN to enable the Otari-powered explanation.',
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${OTARI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: 'You explain smart-contract safety checks in plain language.' },
          { role: 'user', content: buildPrompt(check) },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { available: false, reason: `Otari API returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) return { available: false, reason: 'Otari returned an empty explanation.' };
    return { available: true, model: json.model || DEFAULT_MODEL, text };
  } catch (err) {
    return { available: false, reason: `Could not reach Otari: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

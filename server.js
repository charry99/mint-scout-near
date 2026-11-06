// Mint Scout NEAR server — stage 2: contract check engine + Otari AI explanations.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAccount } from './lib/checker.js';
import { explainCheck, otariAvailable } from './lib/otari.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mint-scout-near', ai: otariAvailable() });
});

app.post('/api/check', async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ ok: false, error: 'accountId is required' });
  }
  try {
    const result = await checkAccount(accountId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: `Check failed: ${err.message}` });
  }
});

// Otari-powered plain-language explanation of a check result.
// Body: { checkResult } — the JSON returned by /api/check.
// Without OTARI_AI_TOKEN this returns { available:false, reason } —
// the rest of the app keeps working.
app.post('/api/explain', async (req, res) => {
  const { checkResult } = req.body || {};
  if (!checkResult || typeof checkResult !== 'object') {
    return res.status(400).json({ ok: false, error: 'checkResult is required' });
  }
  const explanation = await explainCheck(checkResult);
  res.json({ ok: true, ...explanation });
});

app.listen(PORT, () => {
  console.log(`Mint Scout NEAR listening on http://localhost:${PORT}`);
});

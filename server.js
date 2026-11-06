// Mint Scout NEAR server — stage 1: NEAR check engine + UI (no AI yet).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAccount } from './lib/checker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'mint-scout-near', ai: false });
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

app.listen(PORT, () => {
  console.log(`Mint Scout NEAR listening on http://localhost:${PORT}`);
});

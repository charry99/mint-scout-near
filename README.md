# Mint Scout NEAR 🔍

Paste a NEAR account, get a verdict — **VERIFIED / NEEDS REVIEW / HIGH RISK** —
from NEP-330 source metadata, on-chain access keys and standards detection,
plus a plain-language AI explanation powered by **Otari** (Mozilla's
open-source AI gateway).

Built for the [NEAR Hackathon 2026 — Build Beyond Boundaries](https://nearhackathon.com)
(deadline Nov 15 2026, 05:29 IST). The NEAR adaptation of
[Mint Scout](../mint-scout/) (BNB contract checker, Mozilla Otari Hackathon).

## What it checks

For any account on NEAR mainnet:

1. **Is it a contract?** — `view_account` code hash vs the empty-code hash
   (a plain wallet account is reported as "not a contract").
2. **Source metadata (NEP-330)** — does the contract publish
   `contract_source_metadata()` with a source link and reproducible build
   info? See [RESEARCH.md](RESEARCH.md) for what NEAR can and cannot prove.
3. **Access keys** — full-access keys can redeploy the contract; zero
   full-access keys means the code cannot be replaced.
4. **Standards** — NEP-141 (`ft_metadata`) / NEP-171 (`nft_metadata`)
   detection, token name / symbol / decimals / total supply where available.
5. **Code hash + deployments** — the on-chain code hash (compare against a
   published release hash) and deployment history from the NearBlocks
   indexer (best-effort, labelled as indexer data).
6. **Verdict heuristics** — published source metadata + no full-access key
   → VERIFIED; unpublished source + full-access key → HIGH RISK;
   everything in between → NEEDS REVIEW.

Everything is read-only. No wallet connection, no signing, no transactions.

## How to run

```bash
npm install
npm start
# → http://localhost:3001
```

Endpoints:

- `GET /api/health` — `{ ok, service, ai }` (`ai` is true only when an Otari token is configured)
- `POST /api/check` — `{ "accountId": "wrap.near" }` → full check result
- `POST /api/explain` — `{ "checkResult": { … } }` → Otari plain-language explanation

## Wiring Otari (AI explanations)

1. Sign up at [otari.ai](https://otari.ai) and copy your API token (starts with `otk_`).
2. Copy `.env.example` to `.env` and set `OTARI_AI_TOKEN=otk_…`.
3. Restart the server. The AI panel appears after every check.

Without a token the app works end-to-end — `/api/explain` returns a clear
graceful fallback (`AI explanation unavailable — set OTARI_AI_TOKEN`) and
nothing else breaks. Never commit `.env` or any token (see `.gitignore`).

The Otari client (`lib/otari.js`) is OpenAI-compatible:
`POST https://api.otari.ai/v1/chat/completions`, default model
`deepseek/deepseek-v4-pro-0813` (override with `OTARI_MODEL`).

## Tests

```bash
npm test
```

Live integration tests against real NEAR mainnet RPC endpoints. See
[TESTS.md](TESTS.md) for recorded results.

## NEAR hackathon submission checklist

- [ ] Working app (NEAR contract checker + Otari AI explanation)
- [ ] Public GitHub repo + `mint-scout-near` branch
- [ ] Push repo to GitHub (needs the user's GitHub account)
- [ ] 3–5 min demo video (post on X, tag @NEARProtocol and #NEARHackathon)
- [ ] Submit the form with repo link + demo post link before Nov 15 05:29 IST

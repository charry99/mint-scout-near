# Mint Scout NEAR — test results

Live integration tests (`npm test`, file `tests/check.test.mjs`) hit real
NEAR mainnet RPC endpoints. Last full run: **2026-11-06 ~08:45 IST — 7/7 pass.**

## Contract checks (NEAR mainnet)

| Account | NEP-330 source metadata | Full-access keys | Verdict | Notes |
|---|---|---|---|---|
| `intents.near` | present, complete (v0.4.5, github.com/near/intents, build info) | 0 of 9 keys | **VERIFIED** | Source published on-chain with a reproducible build trail; no key can redeploy the code. Standards detected: dip4, nep245, nep330. |
| `ref-finance.near` | unknown — view calls fail | 1 | **HIGH RISK** | Old WASM cannot be view-called by current nodes (`CompilationError(PrepareError(Deserialization))` on both RPCs), so nothing about its behaviour can be read — and a single full-access key can replace the code. See the reputation note below. |
| `wrap.near` | absent | 0 | **NEEDS REVIEW** | Immutable (no keys at all) but publishes no source metadata. FT detected: wNEAR, 24 decimals. |
| `usdt.tether-token.near` | absent | 0 | **NEEDS REVIEW** | Immutable but no source metadata. FT detected: USDt. |
| `illia.near` (wallet) | n/a | n/a | **not a contract** | Code hash is the empty-code hash `111…1` — correctly identified as a wallet, not a contract. |

Plus: a nonexistent account returns a clear `does not exist` error.

## Otari explain

- Without `OTARI_AI_TOKEN`: `/api/explain` returns
  `{ available: false, reason: "AI explanation unavailable — set OTARI_AI_TOKEN …" }`
  and everything else still works. Covered by the test
  "Otari explain — graceful fallback without a token".
- With a token set: live Otari call is attempted (not tested in CI runs —
  no token is available in this environment).

## Server smoke test (2026-11-06 ~08:45 IST)

- `GET /api/health` → `{ ok: true, service: "mint-scout-near", ai: false }`
- `POST /api/check { accountId: "intents.near" }` → `VERIFIED`
- `POST /api/explain` without a token → graceful fallback
- `GET /` (UI) → 200

## The ref-finance.near reputation note

Ref Finance is a well-known, audited NEAR project — and this engine still
calls it HIGH RISK. That is deliberate: the verdict reflects only what the
chain can prove. Its contract publishes no NEP-330 source metadata, its
methods cannot be executed by current nodes (old WASM), and one full-access
key can replace the code. Off-chain reputation (audits, team, track record)
is real evidence, but it lives outside what this app can verify — the same
way Mint Scout (BNB) judges contracts on-chain evidence alone. If Ref
Finance published NEP-330 metadata, the verdict would move to NEEDS REVIEW
(source published, key holder still trusted) or VERIFIED (if the keys were
also removed).

## Bugs found and fixed during testing

1. **MethodNotFound arrives inside `result.error`, not as an RPC error** —
   NEAR `call_function` returns HTTP 200 with
   `result.error: "wasm execution failed … MethodNotFound"` when a method
   does not exist. The RPC client initially only checked JSON-RPC-level
   errors, so every missing method was treated as a failed read and all
   metadata came back "unknown". Fixed in `lib/near.js`: a
   `MethodNotFound` result-error now returns `null` (method absent).
2. **Old WASM breaks view calls** — `ref-finance.near` fails every view
   call with `CompilationError(PrepareError(Deserialization))` on both
   RPC endpoints. The engine now records this as `viewCallsBroken` and
   explains it in the checklist instead of silently reporting "unknown".
   The verdict logic was also corrected so that (unverifiable source +
   full-access key) is HIGH RISK rather than falling through to the
   cautious NEEDS REVIEW default.

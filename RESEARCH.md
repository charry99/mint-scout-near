# Mint Scout NEAR — research findings (Step 1)

Researched 2026-11-06, verified live against NEAR mainnet. This is what
NEAR actually offers for checking a contract — and what it cannot prove.

## NEAR mainnet RPC (no key needed)

- Endpoint: `https://rpc.mainnet.near.org` (official), fallback
  `https://free.rpc.fastnear.com` (FastNear free RPC). Both verified live.
- `https://1rpc.io/near` was tested and does **not** support the `query`
  method — it is deliberately not a fallback.
- All reads go through one JSON-RPC method, `query`, with a `request_type`:
  - `view_account` → balance, `code_hash`, storage usage. Throws
    `UNKNOWN_ACCOUNT` for a missing account.
  - `view_code` → the deployed WASM (base64). The app avoids downloading
    it and uses `view_account`'s `code_hash` instead.
  - `view_access_key_list` → every key on the account with its permission
    (`FullAccess` vs function-call).
  - `view_state` → contract storage key-values (available; the app does
    not currently need it).
  - `call_function` → read-only view call. The result is a byte array;
    `ft_metadata` / `nft_metadata` / `contract_source_metadata` return
    JSON. A missing method returns HTTP 200 with
    `result.error: "… MethodNotFound"` — not a JSON-RPC error.
- The empty-code hash is `11111111111111111111111111111111` — that is how
  a plain wallet account is distinguished from a contract.

## Source verification on NEAR — what exists

NEAR has **no Sourcify equivalent** — no central registry where you can
look up a contract and get an exact/partial match. What exists instead:

### 1. NEP-330 Contract Source Metadata (the on-chain signal)

- Standard (Final, v1.2.0/1.3.0): a contract may expose a
  `contract_source_metadata()` view method returning
  `{ version, link, standards[], build_info }`, where `build_info` holds
  `build_environment` (a pinned Docker image with SHA-256 digest),
  `build_command`, `contract_path` and `source_code_snapshot`
  (a `git+https://…?rev=…` URL).
- Adoption is **optional**. Even `wrap.near` (the canonical wNEAR
  contract) does not implement it. `intents.near` does (v0.4.5, link to
  `github.com/near/intents` at a pinned commit, `sourcescan/cargo-near`
  build image).
- What it proves: the deployer *published* a source link and a
  reproducible build recipe on-chain. What it does **not** prove by
  itself: that the published source actually builds to the deployed
  WASM — that needs the build to be re-run and the hashes compared.

### 2. SourceScan / NearBlocks "Verify and Publish" (the reproduced-build proof)

- NearBlocks shows a "Contract Code" tab with a "Verify and Publish"
  button. The flow extracts the NEP-330 metadata, clones the git repo
  at the specified commit, builds in the exact Docker image from the
  metadata, and compares the resulting WASM hash with the on-chain
  code hash.
- **No reliable no-key API exists to query this status.** The NearBlocks
  public API (`https://api.nearblocks.io/v1/account/{id}`,
  `/contract`, `/contract/deployments`) works without a key but exposes
  account info, code and deployment history — no verified flag.
  `sourcescan.io` has no reachable public API endpoint (probed
  2026-11-06). So the app cannot confirm a reproduced-build match
  programmatically; it reports the NEP-330 metadata and is honest about
  that limit in the VERIFIED summary.

### 3. Code-hash matching (manual, always available)

- `view_account` always returns the on-chain code hash (base58). The app
  reports it on every check so anyone can compare it against a hash
  published in a project's release notes or repo.

## Access keys — the upgradeability question

- A **full-access key** can do anything for the account, including
  deploying new code and adding/removing keys. Whoever holds one can
  replace the contract at any time.
- A **function-call key** is restricted to specific methods on a specific
  receiver and cannot deploy code or manage keys.
- **Zero full-access keys means the code cannot be replaced**: adding a
  key itself requires full access, so an account with no full-access key
  is effectively locked. `wrap.near` and `usdt.tether-token.near` hold
  no keys at all; `intents.near` holds 9 function-call keys and 0
  full-access keys.
- Caveat: keys can be added or removed over time, so this is a
  point-in-time fact — the check reports the current state.

## Standards detection

- NEP-141 fungible token: `ft_metadata()` → `{ spec, name, symbol,
  decimals }`, plus `ft_total_supply()`.
- NEP-171 NFT: `nft_metadata()` → `{ spec, name, symbol, … }`.
- The NEP-330 metadata itself also lists supported standards
  (e.g. `intents.near` lists `dip4`, `nep245`, `nep330`).

## What the app cannot verify (honest limits)

- **Reproduced-build confirmation** — the app does not re-run Docker
  builds; that confirmation lives on SourceScan / NearBlocks.
- **Off-chain reputation** — audits, team identity, track record. The
  engine judges on-chain evidence only (see the ref-finance note in
  TESTS.md).
- **Old contracts' behaviour** — some very old deployments (e.g.
  `ref-finance.near`) fail every view call with
  `CompilationError(PrepareError(Deserialization))` on current nodes.
  Their methods cannot be read at all; the app reports this explicitly
  (`viewCallsBroken`) instead of guessing.
- **Whether a full-access key holder is trustworthy** — the app can only
  report that such a key exists, not who holds it or what they intend.

## Test accounts (live state, 2026-11-06)

| Account | Code hash | NEP-330 | Full-access keys | Notes |
|---|---|---|---|---|
| `intents.near` | `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk` | present, complete (v0.4.5) | 0 of 9 | VERIFIED case |
| `wrap.near` | `DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1` | absent | 0 of 0 | wNEAR, 24 decimals |
| `ref-finance.near` | (view calls fail) | unknown | 1 | old WASM, view-calls-broken |
| `usdt.tether-token.near` | — | absent | 0 of 0 | USDt |
| `illia.near` | `111…1` (empty) | n/a | 1 (wallet) | not a contract |

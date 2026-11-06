// Mint Scout NEAR check engine — the core value.
// For a NEAR account it:
//   1. confirms it is a contract (view_account code_hash vs the empty hash)
//   2. reads NEP-330 source metadata (contract_source_metadata view call):
//      source link + reproducible build info, when the contract publishes it
//   3. lists access keys — full-access keys can redeploy the contract, so
//      zero full-access keys means the code cannot be replaced
//   4. detects standards (NEP-141 ft_metadata, NEP-171 nft_metadata) and
//      reads token metadata + total supply where available
//   5. reports the on-chain code hash (so anyone can compare it against a
//      published release hash) and deployment history from the NearBlocks
//      indexer (best-effort, labelled as indexer data)
//   6. produces a VERIFIED / NEEDS REVIEW / HIGH RISK verdict + checklist
// Never fabricates data: anything that could not be read is "unknown".
// See RESEARCH.md for what NEAR can and cannot prove about a contract.
import {
  EMPTY_CODE_HASH,
  viewAccount,
  viewAccessKeyList,
  callFunction,
  yoctoToNear,
  nearblocksDeployments,
} from './near.js';

const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;

/**
 * Run the full check. Returns a structured result object (JSON-safe).
 */
export async function checkAccount(accountIdInput) {
  const accountId = (accountIdInput || '').trim();
  const checks = [];
  const facts = { accountId };
  const flags = [];

  if (!ACCOUNT_RE.test(accountId)) {
    return {
      ok: false,
      error:
        'Invalid NEAR account ID — expected 2–64 lowercase characters (a–z, 0–9, . _ -), e.g. wrap.near.',
      accountId,
    };
  }

  // 1. Account state: does it exist, and does it hold contract code?
  let account;
  try {
    account = await viewAccount(accountId);
  } catch (err) {
    if (err.code === 'UNKNOWN_ACCOUNT') {
      return { ok: false, error: `Account ${accountId} does not exist on NEAR mainnet.`, accountId };
    }
    return { ok: false, error: `Could not read chain state: ${err.message}`, accountId };
  }
  const codeHash = account.code_hash || null;
  facts.codeHash = codeHash;
  facts.balanceYocto = account.amount || null;
  facts.balanceNear = account.amount ? yoctoToNear(account.amount) : null;
  facts.storageUsage = account.storage_usage ?? null;
  facts.locked = account.locked || '0';

  const isContract = Boolean(codeHash) && codeHash !== EMPTY_CODE_HASH;
  checks.push({
    id: 'isContract',
    label: 'Account holds contract code',
    status: isContract ? 'pass' : 'fail',
    detail: isContract
      ? `Code hash ${codeHash} — WASM is deployed on this account.`
      : 'No code on this account — it is a plain wallet account, not a contract.',
  });
  if (!isContract) {
    return {
      ok: true,
      kind: 'not_contract',
      verdict: null,
      accountId,
      checks,
      facts,
      flags: ['not-a-contract'],
      summary: 'This account is a wallet, not a contract. There is nothing to verify here.',
    };
  }

  // 2. Access keys — who can redeploy this contract?
  let fullAccessKeys = null;
  let functionCallKeys = null;
  let totalKeys = null;
  try {
    const keyList = await viewAccessKeyList(accountId);
    const keys = Array.isArray(keyList.keys) ? keyList.keys : [];
    totalKeys = keys.length;
    const full = keys.filter((k) => k.access_key && k.access_key.permission === 'FullAccess');
    fullAccessKeys = full.length;
    functionCallKeys = totalKeys - fullAccessKeys;
    facts.totalKeys = totalKeys;
    facts.fullAccessKeys = fullAccessKeys;
    facts.functionCallKeys = functionCallKeys;
    facts.fullAccessKeyIds = full.slice(0, 3).map((k) => k.public_key);
  } catch {
    facts.totalKeys = null;
    facts.fullAccessKeys = null;
    facts.functionCallKeys = null;
  }

  if (fullAccessKeys === null) {
    checks.push({
      id: 'accessKeys',
      label: 'Access keys readable',
      status: 'unknown',
      detail: 'view_access_key_list failed — it is unknown who can redeploy this contract.',
    });
    flags.push('keys-unknown');
  } else if (fullAccessKeys === 0) {
    checks.push({
      id: 'accessKeys',
      label: 'No full-access key can redeploy the contract',
      status: 'pass',
      detail:
        totalKeys === 0
          ? 'The account holds no keys at all — the deployed code cannot be replaced.'
          : `${totalKeys} key(s) on the account, all function-call only — none can deploy new code or add keys.`,
    });
    flags.push('locked-no-keys');
  } else {
    checks.push({
      id: 'accessKeys',
      label: 'No full-access key can redeploy the contract',
      status: 'fail',
      detail: `${fullAccessKeys} full-access key(s) on the account — whoever holds one can replace the contract code at any time.`,
    });
    flags.push('full-access-keys');
  }

  // 3. NEP-330 source metadata — the on-chain source-publication signal.
  // Present means the contract exposes contract_source_metadata(); complete
  // means it also carries a source link and reproducible build info.
  let metadataStatus = 'unknown';
  let metadata = null;
  let metadataComplete = false;
  let metadataNote = null;
  let viewFailures = 0;
  try {
    const meta = await callFunction(accountId, 'contract_source_metadata', {});
    if (meta === null) {
      metadataStatus = 'absent';
    } else if (meta && typeof meta === 'object') {
      metadataStatus = 'present';
      metadata = {
        version: meta.version ?? null,
        link: meta.link ?? null,
        standards: Array.isArray(meta.standards) ? meta.standards : [],
        buildInfo: meta.build_info
          ? {
              buildEnvironment: meta.build_info.build_environment ?? null,
              buildCommand: Array.isArray(meta.build_info.build_command)
                ? meta.build_info.build_command
                : null,
              sourceCodeSnapshot: meta.build_info.source_code_snapshot ?? null,
              contractPath: meta.build_info.contract_path ?? null,
            }
          : null,
      };
      metadataComplete = Boolean(
        metadata.link && metadata.buildInfo && metadata.buildInfo.sourceCodeSnapshot
      );
    } else {
      metadataStatus = 'unknown';
    }
  } catch (err) {
    // A non-MethodNotFound failure (e.g. CompilationError/PrepareError on
    // very old WASM) means the method cannot be executed at all — the
    // contract may or may not publish metadata; that is unknowable here.
    metadataStatus = 'unknown';
    viewFailures += 1;
    if (/CompilationError|PrepareError/.test(err.message || '')) {
      metadataNote =
        'View calls fail with a WASM preparation error — this contract’s methods cannot be executed by current nodes (common for very old deployments).';
    }
  }
  facts.sourceMetadataStatus = metadataStatus;
  facts.sourceMetadata = metadata;
  facts.sourceMetadataComplete = metadataComplete;

  if (metadataStatus === 'present') {
    checks.push({
      id: 'sourceMetadata',
      label: 'Source metadata published on-chain (NEP-330)',
      status: metadataComplete ? 'pass' : 'unknown',
      detail: metadataComplete
        ? `Source: ${metadata.link} (version ${metadata.version || '?'}) with reproducible build info — anyone can rebuild and compare the WASM hash.`
        : `Metadata is published but incomplete (link: ${metadata.link || 'none'}, build info: ${metadata.buildInfo ? 'present' : 'none'}) — the source trail is partial.`,
    });
    flags.push('source-metadata');
    if (!metadataComplete) flags.push('source-metadata-incomplete');
  } else if (metadataStatus === 'absent') {
    checks.push({
      id: 'sourceMetadata',
      label: 'Source metadata published on-chain (NEP-330)',
      status: 'fail',
      detail:
        'No contract_source_metadata() — the contract publishes no source link or build info, so its code cannot be matched to published source from on-chain data.',
    });
    flags.push('unverified-source');
  } else {
    checks.push({
      id: 'sourceMetadata',
      label: 'Source metadata published on-chain (NEP-330)',
      status: 'unknown',
      detail:
        metadataNote ||
        'The source-metadata read failed — verification status could not be determined.',
    });
    flags.push('verification-unknown');
  }

  // 4. Standards detection + token metadata reads (each independent).
  const standards = [];
  if (metadata && Array.isArray(metadata.standards)) {
    for (const s of metadata.standards) {
      if (s && s.standard) standards.push(String(s.standard).toLowerCase());
    }
  }
  let ft = null;
  let nft = null;
  try {
    const meta = await callFunction(accountId, 'ft_metadata', {});
    if (meta && typeof meta === 'object') {
      ft = {
        spec: meta.spec ?? null,
        name: meta.name ?? null,
        symbol: meta.symbol ?? null,
        decimals: meta.decimals ?? null,
      };
      if (!standards.includes('nep141')) standards.push('nep141');
      try {
        const supply = await callFunction(accountId, 'ft_total_supply', {});
        ft.totalSupply = supply ?? null;
      } catch {
        ft.totalSupply = null;
      }
    }
  } catch {
    // Method exists but the read failed — recorded as unknown, not absent.
    viewFailures += 1;
    if (!standards.includes('nep141')) standards.push('nep141?');
  }
  try {
    const meta = await callFunction(accountId, 'nft_metadata', {});
    if (meta && typeof meta === 'object') {
      nft = {
        spec: meta.spec ?? null,
        name: meta.name ?? null,
        symbol: meta.symbol ?? null,
      };
      if (!standards.includes('nep171')) standards.push('nep171');
    }
  } catch {
    viewFailures += 1;
    if (!standards.includes('nep171')) standards.push('nep171?');
  }
  facts.standards = standards.filter((s) => !s.endsWith('?'));
  facts.ft = ft;
  facts.nft = nft;
  // All three view probes failed for a reason other than "method not
  // found": this contract's methods cannot be executed by current nodes.
  const viewCallsBroken = viewFailures >= 3 && !ft && !nft;
  facts.viewCallsBroken = viewCallsBroken;
  if (viewCallsBroken) flags.push('view-calls-broken');

  checks.push({
    id: 'standards',
    label: 'Token standard detected',
    status: standards.length > 0 ? 'pass' : 'unknown',
    detail: viewCallsBroken
      ? 'View calls fail on this contract (WASM preparation error) — no method, including ft_metadata / nft_metadata, can be executed by current nodes, so no standard can be detected.'
      : standards.length > 0
        ? `Detected: ${standards.join(', ')}${ft ? ` — ${ft.name || '?'} (${ft.symbol || '?'})${ft.decimals !== null && ft.decimals !== undefined ? `, ${ft.decimals} decimals` : ''}` : ''}${nft ? ` — NFT ${nft.name || '?'} (${nft.symbol || '?'})` : ''}`
        : 'No NEP-141 (fungible) or NEP-171 (NFT) metadata responded — this may be a custom contract, not a standard token.',
  });
  if (ft) flags.push('nep141');
  if (nft) flags.push('nep171');
  if (ft && ft.totalSupply !== null && ft.totalSupply !== undefined) {
    checks.push({
      id: 'totalSupply',
      label: 'Total supply readable on-chain',
      status: 'pass',
      detail: `ft_total_supply = ${ft.totalSupply} (raw units; divide by 10^decimals for tokens)`,
    });
  }

  // 5. Deployment history (NearBlocks indexer — best-effort, labelled as such).
  const deployments = await nearblocksDeployments(accountId);
  facts.deployments = deployments;
  if (deployments) {
    checks.push({
      id: 'deployments',
      label: 'Deployment history (NearBlocks indexer)',
      status: 'pass',
      detail:
        deployments.count === 0
          ? 'No deployments recorded by the indexer.'
          : `${deployments.count} deployment(s) recorded${deployments.latest ? `, latest ${deployments.latest}` : ''}.`,
    });
  } else {
    checks.push({
      id: 'deployments',
      label: 'Deployment history (NearBlocks indexer)',
      status: 'unknown',
      detail: 'Indexer unreachable — deployment history could not be read.',
    });
    flags.push('deployments-unknown');
  }

  // 6. Verdict heuristics.
  // VERIFIED needs BOTH: published source metadata with a reproducible
  // build trail, AND no full-access key that could replace the code.
  // HIGH RISK: no verifiable source transparency (unpublished, or view
  // calls fail so nothing can be read) AND a full-access key can replace
  // the code at any time — unverifiable and unilaterally upgradeable.
  // NEEDS REVIEW: everything in between (immutable but unverified,
  // published but upgradeable, incomplete metadata, or unreadable evidence
  // with no upgrade key).
  const hasMetadata = metadataStatus === 'present' && metadataComplete;
  const metadataIncomplete = metadataStatus === 'present' && !metadataComplete;
  const noMetadata = metadataStatus === 'absent';
  const metadataUnknown = metadataStatus === 'unknown';
  const keysUnknown = fullAccessKeys === null;
  const locked = fullAccessKeys === 0;
  const upgradeable = fullAccessKeys !== null && fullAccessKeys > 0;

  let verdict;
  let summary;
  if (hasMetadata && locked) {
    verdict = 'VERIFIED';
    summary =
      'Source metadata is published on-chain (NEP-330) with a reproducible build trail, and no full-access key exists that could replace the code. Caveat: this app does not re-run the Docker build itself — the reproduced-build confirmation lives on SourceScan / NearBlocks, and verification proves the code, not the project.';
  } else if ((noMetadata || metadataUnknown) && upgradeable) {
    verdict = 'HIGH RISK';
    summary =
      'The contract has no verifiable source transparency, and a full-access key can replace its code at any time. Nothing about what it does can be confirmed from source, and the code can change without warning — do not interact with it on trust alone.';
  } else if (metadataUnknown || keysUnknown) {
    verdict = 'NEEDS REVIEW';
    summary =
      'Key evidence could not be read, so the verdict is cautious by default. Re-check before interacting with this contract.';
  } else if (metadataIncomplete) {
    verdict = 'NEEDS REVIEW';
    summary =
      'Source metadata is published but incomplete — the source trail is partial, so the deployed code cannot be fully matched to published source from on-chain data.';
  } else if (hasMetadata && upgradeable) {
    verdict = 'NEEDS REVIEW';
    summary =
      'Source metadata is published, but a full-access key can still replace the contract code. The mechanics are transparent; the trust question is the key holder.';
  } else {
    verdict = 'NEEDS REVIEW';
    summary =
      'The code cannot be replaced (no full-access key), but no source metadata is published, so its behaviour cannot be confirmed from source. Immutable does not mean audited.';
  }

  return {
    ok: true,
    kind: 'contract',
    verdict,
    accountId,
    checks,
    facts,
    flags,
    summary,
  };
}

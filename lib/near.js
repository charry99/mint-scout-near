// NEAR mainnet JSON-RPC helper with endpoint fallback + per-call timeouts.
// Plain fetch — no SDK. The NEAR RPC is a single `query` method whose
// request_type selects the read (view_account, view_code, view_access_key_list,
// view_state, call_function).
//
// Endpoints verified live 2026-11-06 (no API key needed for these reads):
//   - https://rpc.mainnet.near.org (official)
//   - https://free.rpc.fastnear.com (FastNear free RPC)
// 1RPC (https://1rpc.io/near) was tested and does NOT support the `query`
// method, so it is deliberately not a fallback.
const ENDPOINTS = [
  'https://rpc.mainnet.near.org',
  'https://free.rpc.fastnear.com',
];

/** The code hash NEAR reports for an account with no contract deployed. */
export const EMPTY_CODE_HASH = '11111111111111111111111111111111';

async function postJson(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) {
      const cause = json.error.cause || {};
      const err = new Error(cause.name || json.error.message || 'NEAR RPC error');
      err.code = cause.name || null;
      err.rpcMessage = json.error.message || '';
      throw err;
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call a NEAR JSON-RPC method, trying each endpoint in order.
 * Returns the `result` of the first success, or throws the last error.
 */
export async function rpcCall(method, params, timeoutMs = 8000) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      return await postJson(url, { jsonrpc: '2.0', id: 1, method, params }, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All NEAR RPC endpoints failed');
}

/** Generic `query` call: { request_type, finality, ...rest }. */
export function query(requestType, rest, timeoutMs = 8000) {
  return rpcCall('query', { request_type: requestType, finality: 'final', ...rest }, timeoutMs);
}

/** view_account — balance, code hash, storage usage. Throws UNKNOWN_ACCOUNT if missing. */
export function viewAccount(accountId) {
  return query('view_account', { account_id: accountId });
}

/** view_access_key_list — every key on the account, with its permission. */
export function viewAccessKeyList(accountId) {
  return query('view_access_key_list', { account_id: accountId });
}

/** view_code — the deployed WASM (base64). Prefer view_account's code_hash; only fetch the bytes when needed. */
export function viewCode(accountId) {
  return query('view_code', { account_id: accountId });
}

/**
 * call_function — read-only view call. Returns the parsed JSON value on
 * success, `null` when the method does not exist on the contract
 * (MethodNotFound), and throws on any other failure so the caller can
 * record "unknown" instead of guessing.
 */
export async function callFunction(accountId, methodName, args = {}) {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  let result;
  try {
    result = await query('call_function', {
      account_id: accountId,
      method_name: methodName,
      args_base64: argsBase64,
    });
  } catch (err) {
    if (err.rpcMessage && err.rpcMessage.includes('MethodNotFound')) return null;
    if (err.message && err.message.includes('MethodNotFound')) return null;
    throw err;
  }
  if (!result || typeof result.error === 'string') {
    // The node ran the call but it failed. MethodNotFound means the
    // contract simply does not implement this method — that is an
    // absence, not an error. Anything else is a genuine failure.
    if (result && typeof result.error === 'string' && result.error.includes('MethodNotFound')) {
      return null;
    }
    throw new Error(result?.error || 'View call failed');
  }
  const bytes = Array.isArray(result.result) ? Buffer.from(result.result) : null;
  if (!bytes) return null;
  const text = bytes.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Format a yoctoNEAR amount (string) as NEAR with up to 4 decimals. */
export function yoctoToNear(amount) {
  try {
    const value = BigInt(amount);
    const whole = value / 10n ** 24n;
    const frac = value % 10n ** 24n;
    const fracStr = frac.toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '') || '0';
    return `${whole}.${fracStr}`;
  } catch {
    return null;
  }
}

/**
 * NearBlocks indexer: contract deployment history for an account.
 * Best-effort only — this is indexer data, not chain state, and it is NOT
 * a verification-status source (NearBlocks exposes no verified flag via API).
 * Returns { count, latest } or null when unreadable.
 */
export async function nearblocksDeployments(accountId, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.nearblocks.io/v1/account/${encodeURIComponent(accountId)}/contract/deployments`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const deps = Array.isArray(json.deployments) ? json.deployments : [];
    if (deps.length === 0) return { count: 0, latest: null };
    const latest = deps[deps.length - 1];
    const ts = latest.block_timestamp ? Number(BigInt(latest.block_timestamp) / 1000000n) : null;
    return {
      count: deps.length,
      latest: ts ? new Date(ts).toISOString() : null,
      latestTx: latest.transaction_hash || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

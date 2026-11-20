/**
 * The token for the AWS agent call, minted by PingFederate on demand (OAuth client credentials) and cached until a
 * minute before it expires. With the Remote Agent app on `token-pass`, the gateway checks this token against the
 * agent's Federated Identity and forwards it to the AWS runtime unchanged, so nothing is pasted into Privilege and
 * nothing long-lived is stored. The client secret stays in this process.
 */
export interface PfTokenSettings {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export type PfTokenProvider = () => Promise<string>;

interface Options {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const REFRESH_EARLY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export function createPfTokenProvider(settings: PfTokenSettings, options: Options = {}): PfTokenProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function mint(): Promise<string> {
    const response = await fetchImpl(settings.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: settings.clientId, client_secret: settings.clientSecret }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON: reported by status below */ }
    if (!response.ok) {
      const reason = typeof body.error === 'string' ? `: ${body.error}` : '';
      throw new Error(`PingFederate refused the token request for client ${settings.clientId} (HTTP ${response.status}${reason}).`);
    }
    const token = body.access_token;
    if (typeof token !== 'string' || !token) throw new Error('PingFederate answered the token request without an access token.');
    const seconds = Number(body.expires_in);
    // No usable lifetime: do not cache, ask again next time.
    cached = Number.isFinite(seconds) && seconds > 0 ? { token, expiresAt: now() + seconds * 1000 } : null;
    return token;
  }

  return async () => {
    if (cached && now() < cached.expiresAt - REFRESH_EARLY_MS) return cached.token;
    pending ??= mint().finally(() => { pending = null; });
    return pending;
  };
}

/**
 * The token for the AWS agent call, minted by PingFederate on demand (OAuth client credentials) and cached until a
 * minute before it expires. With the Remote Agent app on `token-pass`, the gateway checks this token against the
 * agent's Federated Identity and forwards it to the AWS runtime unchanged, so nothing is pasted into Privilege and
 * nothing long-lived is stored. The client secret stays in this process.
 */
import { describeToken, type TokenView } from './tokenView.js';

export interface PfTokenSettings {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/** What the trace may show of the last token request: the exchange as text (secret masked, token never included) and the token decoded. */
export interface PfMint {
  /** The request as text. The client secret is shown as ******. */
  request: string;
  /** The reply as text, with the access token replaced by a note; its decoded form is `token`. */
  response: string;
  status: number;
  elapsedMs: number;
  token: TokenView;
}

export interface PfTokenProvider {
  /** The bearer token. `fresh` skips the cache and mints a new one, so a run can show the mint. */
  (options?: { fresh?: boolean }): Promise<string>;
  /** A description of the most recent mint, or null before the first one. Never contains the token or the secret. */
  lastMint(): PfMint | null;
}

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
  let last: PfMint | null = null;

  async function mint(): Promise<string> {
    const started = Date.now();
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
    last = {
      request: [
        `POST ${settings.tokenUrl}`,
        'Content-Type: application/x-www-form-urlencoded',
        '',
        'grant_type=client_credentials',
        `client_id=${settings.clientId}`,
        'client_secret=******',
      ].join('\n'),
      response: `HTTP ${response.status}\n${JSON.stringify({
        token_type: typeof body.token_type === 'string' ? body.token_type : undefined,
        expires_in: Number.isFinite(seconds) ? seconds : undefined,
        scope: typeof body.scope === 'string' ? body.scope : undefined,
        access_token: '(the token itself is not shown; it is decoded under "The token")',
      }, null, 2)}`,
      status: response.status,
      elapsedMs: Date.now() - started,
      token: describeToken(token, now()),
    };
    // No usable lifetime: do not cache, ask again next time.
    cached = Number.isFinite(seconds) && seconds > 0 ? { token, expiresAt: now() + seconds * 1000 } : null;
    return token;
  }

  const provider = async (options?: { fresh?: boolean }): Promise<string> => {
    if (!options?.fresh && cached && now() < cached.expiresAt - REFRESH_EARLY_MS) return cached.token;
    pending ??= mint().finally(() => { pending = null; });
    return pending;
  };
  return Object.assign(provider, { lastMint: () => last });
}

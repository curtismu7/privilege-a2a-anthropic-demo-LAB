/**
 * What the UI may show of a bearer credential: a decoded JWT (header and claims), or just the length of an opaque key.
 * The signature is never returned, in whole or in part, and the raw token is never returned or logged. Nothing here checks
 * the signature: the view says so. Malformed input never throws; it is described as opaque.
 */

export const TOKEN_NOTE = 'decoded here, signature not verified';

export interface JwtView {
  kind: 'jwt';
  header: { alg?: string; kid?: string; typ?: string };
  /** Registered and custom claims, size-capped. Nested objects (such as `act`) are kept to a few levels. */
  claims: Record<string, unknown>;
  signature: 'hidden';
  issuedAt?: string;
  expiresAt?: string;
  lifetimeSeconds?: number;
  /** Seconds from `now` until expiry; negative once expired. */
  expiresInSeconds?: number;
  note: typeof TOKEN_NOTE;
}

export interface OpaqueView {
  kind: 'opaque';
  length: number;
}

export type TokenView = JwtView | OpaqueView;

const MAX_STRING = 300;
const MAX_ITEMS = 20;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string): Record<string, unknown> | null {
  if (!segment || !SEGMENT.test(segment)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cap(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => cap(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS).map(([key, item]) => [key.slice(0, 80), cap(item, depth + 1)]));
  }
  return String(value);
}

const headerText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value.slice(0, 120) : undefined);
const seconds = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const iso = (secondsSinceEpoch: number | undefined): string | undefined => {
  if (secondsSinceEpoch === undefined) return undefined;
  const date = new Date(secondsSinceEpoch * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** Describe a bearer credential for display. `now` is milliseconds since the epoch. */
export function describeToken(bearer: string, now: number = Date.now()): TokenView {
  const opaque: OpaqueView = { kind: 'opaque', length: typeof bearer === 'string' ? bearer.length : 0 };
  try {
    if (typeof bearer !== 'string') return opaque;
    const parts = bearer.trim().split('.');
    if (parts.length !== 3) return opaque;
    const header = decodeSegment(parts[0] ?? '');
    const payload = decodeSegment(parts[1] ?? '');
    if (!header || !payload || typeof header.alg !== 'string') return opaque;

    const iat = seconds(payload.iat);
    const exp = seconds(payload.exp);
    const claims = cap(payload, 0) as Record<string, unknown>;
    const issuedAt = iso(iat);
    const expiresAt = iso(exp);
    const alg = headerText(header.alg);
    const kid = headerText(header.kid);
    const typ = headerText(header.typ);
    return {
      kind: 'jwt',
      header: { ...(alg ? { alg } : {}), ...(kid ? { kid } : {}), ...(typ ? { typ } : {}) },
      claims,
      signature: 'hidden',
      ...(issuedAt ? { issuedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(iat !== undefined && exp !== undefined ? { lifetimeSeconds: exp - iat } : {}),
      ...(exp !== undefined ? { expiresInSeconds: Math.round(exp - now / 1000) } : {}),
      note: TOKEN_NOTE,
    };
  } catch {
    return opaque;
  }
}

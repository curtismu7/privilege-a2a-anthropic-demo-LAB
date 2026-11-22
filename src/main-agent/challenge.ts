/**
 * A WWW-Authenticate header, read into its scheme and parameters so the trace can explain each one (RFC 9110 section 11.6.1;
 * the Bearer parameters are RFC 6750 section 3 and RFC 9728 section 5.1). Only the first challenge is read. Never throws.
 */
export interface Challenge {
  scheme: string;
  params: Record<string, string>;
}

const MAX_PARAMS = 12;
const MAX_VALUE = 500;
const PARAM = /([A-Za-z0-9_.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,"]+))/g;

export function parseChallenge(header: string): Challenge | null {
  const raw = typeof header === 'string' ? header.trim() : '';
  const scheme = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+/.exec(raw)?.[0];
  if (!scheme) return null;
  const params: Record<string, string> = {};
  let count = 0;
  for (const match of raw.slice(scheme.length).matchAll(PARAM)) {
    if (count >= MAX_PARAMS) break;
    const name = (match[1] ?? '').toLowerCase();
    const value = (match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]) ?? '';
    if (!name || Object.hasOwn(params, name)) continue;
    params[name] = value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
    count += 1;
  }
  return { scheme, params };
}

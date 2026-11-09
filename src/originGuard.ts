// Host check and same-origin writes for the main agent's browser-facing API (family rule; reference:
// token-workbench-LAB server/src/safety.js). The worker and MCP server are internal peers (A2A and MCP calls carry no
// browser Origin) and do not use this.
//  - Host: loopback always (any port), plus the LAB_ALLOWED_HOSTS names (the lab-proxy's Host for this lab) on this
//    server's own port. Anything else is refused with 421 before routing (DNS rebinding).
//  - Writes (anything but GET/HEAD/OPTIONS): Sec-Fetch-Site cross-site is refused. An Origin, when present, must be the
//    loopback http origin of the Host, or, on an allowed lab-proxy Host only, exactly
//    `${X-Forwarded-Proto}://${X-Forwarded-Host}` (the proxy's browser origin); otherwise 403. Forwarded headers are ignored
//    on any other Host. A write with no Origin (a server-to-server caller such as a BFF) passes, as in token-workbench.
import type { NextFunction, Request, Response } from 'express';

type Headers = Record<string, string | string[] | undefined>;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
export function isLoopbackName(name: string): boolean {
  const h = name.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || LOOPBACK_V4.test(h);
}

const DNS_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
export const labAllowedHosts = (raw: string | undefined): Set<string> =>
  new Set(String(raw ?? '').split(',').map(h => h.trim().toLowerCase()).filter(h => DNS_NAME.test(h)));

interface ParsedHost { name: string; port: number | null; host: string }
// "name" or "name:port"; IPv6 only as [::1]. Anything else -> null.
const HOST_RE = /^(\[::1\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i;
export function parseHost(hostHeader: unknown): ParsedHost | null {
  const raw = typeof hostHeader === 'string' ? hostHeader.trim() : '';
  const m = HOST_RE.exec(raw);
  if (!m) return null;
  const port = m[2] === undefined ? null : Number(m[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { name: (m[1] ?? '').toLowerCase(), port, host: raw.toLowerCase() };
}

const isLabHost = (h: ParsedHost | null, names: Set<string>, port: number): boolean =>
  h !== null && !isLoopbackName(h.name) && names.has(h.name) && h.port === port;

export function hostAllowed(hostHeader: unknown, names: Set<string>, port: number): boolean {
  const h = parseHost(hostHeader);
  return h !== null && (isLoopbackName(h.name) || isLabHost(h, names, port));
}

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(',') : v ?? '');
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function writeAllowed(method: string, headers: Headers, names: Set<string>, port: number): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  if (one(headers['sec-fetch-site']).toLowerCase() === 'cross-site') return false;
  if (headers.origin === undefined) return true;
  const origin = one(headers.origin);
  const h = parseHost(headers.host);
  if (h === null) return false;
  if (isLabHost(h, names, port)) {
    const xfh = one(headers['x-forwarded-host']).trim().toLowerCase();
    const xfp = one(headers['x-forwarded-proto']).trim().toLowerCase();
    return xfh !== '' && (xfp === 'https' || xfp === 'http') && origin === `${xfp}://${xfh}`;
  }
  if (!isLoopbackName(h.name)) return false;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  return u.protocol === 'http:' && isLoopbackName(u.hostname) && u.host.toLowerCase() === h.host && origin === u.origin;
}

/** Express middleware: mount first on the main agent's app. */
export function sameOriginGuard(names: Set<string>, port: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hostAllowed(req.headers.host, names, port)) {
      res.status(421).json({ error: 'bad_host', message: 'this server answers loopback Host headers and its lab-proxy name only' });
      return;
    }
    if (!writeAllowed(req.method, req.headers, names, port)) {
      res.status(403).json({ error: 'bad_origin', message: 'this server accepts same-origin writes only' });
      return;
    }
    next();
  };
}

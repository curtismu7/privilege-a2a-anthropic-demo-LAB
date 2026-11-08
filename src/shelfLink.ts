// shelf-link service: server side (TypeScript port of the family module shared/shelf-link/shelf.js).
// GET /api/shelf returns the shelf (launcher) URL from SHELF_URL, or from the shared settings file
// (STANDALONE_ENV, else the home Development .env). No hardcoded host here (hygiene: repo text carries only
// .invalid/.example names): unconfigured means shelfUrl null and the page renders no button.
import fs from 'node:fs';

type Env = Record<string, string | undefined>;

const clean = (raw: string): string => raw.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

function readShelfUrl(env: Env): string | null {
  if (env.SHELF_URL) return clean(String(env.SHELF_URL));
  const candidates: string[] = [];
  if (env.STANDALONE_ENV) candidates.push(env.STANDALONE_ENV);
  candidates.push(`${env.HOME || ''}/Development/.env`);
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.split('\n').map(line => line.match(/^SHELF_URL=(.*)$/)).find(Boolean);
      if (match?.[1] !== undefined) return clean(match[1]);
    } catch { /* next candidate */ }
  }
  return null;
}

export function shelfInfo(env: Env = process.env): { shelfUrl: string | null } {
  return { shelfUrl: readShelfUrl(env) };
}

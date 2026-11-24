import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Story mode (shared pattern: shared/story/README.md in AI-DEMO-Standalone). The wording lives in video/captions.md, the ONE file the recorded video and the
// live Story both read. The shared parser is vendored plain JS (server/src/story/, pinned by web/src/story/story.sha256); this file is the lab's own glue:
// it reads the file (again whenever it changes), parses it, and answers GET /api/story. Nothing here makes a network call.
// @ts-expect-error the vendored parser is plain JavaScript, its shape is typed below
import { parseCaptions } from '../server/src/story/captions.js';

export interface StorySlide { title: string; lead: string; verdict: string; colA: { heading: string; lines: string[] }; colB: { heading: string; lines: string[] }; image: string | null; wide: boolean }
export interface StoryCaptions { opening: StorySlide; closing: StorySlide; slides: Record<string, StorySlide>; steps: Record<string, { title: string; text: string }> }

/** video/captions.md, one level up from src/ and from dist/ (the Dockerfile copies it to /app/video). */
export const CAPTIONS_PATH = fileURLToPath(new URL('../video/captions.md', import.meta.url));

let cached: { parsed: StoryCaptions; mtimeMs: number } | null = null;

/** The wording, parsed again whenever the file changes (a fix to captions.md shows in the live Story as it does in the next video). A broken file throws a CaptionsError that names the problem. */
export function loadCaptions(path: string = CAPTIONS_PATH): StoryCaptions {
  const mtimeMs = statSync(path).mtimeMs;
  if (path === CAPTIONS_PATH && cached && cached.mtimeMs === mtimeMs) return cached.parsed;
  const parsed = parseCaptions(readFileSync(path, 'utf8')) as StoryCaptions;
  if (path === CAPTIONS_PATH) cached = { parsed, mtimeMs };
  return parsed;
}

export function resetCaptionsCache(): void { cached = null; }

/** The SHA-256 of the wording file's bytes, served with the wording so a client (the video) can tell it is reading the file it thinks it is, not a stale copy baked into an older image. */
export const captionsSha256 = (path: string = CAPTIONS_PATH): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** GET /api/story: the wording only. No tenant, host or key is in captions.md (the repo is public), and nothing else is added. */
export function storyResponse(path: string = CAPTIONS_PATH): { status: number; body: (StoryCaptions & { sourceSha256: string }) | { error: string } } {
  try { return { status: 200, body: { ...loadCaptions(path), sourceSha256: captionsSha256(path) } }; }
  catch (e) {
    // A wording problem (CaptionsError) names itself so the editor can fix it. Anything else (a missing file) is logged here and never sent: its text holds the server's paths.
    if (e instanceof Error && e.name === 'CaptionsError') return { status: 500, body: { error: `Story wording could not be read: ${e.message}` } };
    console.error('story: captions.md could not be read:', e instanceof Error ? e.message : e);
    return { status: 500, body: { error: 'Story wording could not be read: the wording file is missing or unreadable.' } };
  }
}

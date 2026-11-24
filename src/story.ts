import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Story mode (shared pattern: shared/story/README.md in AI-DEMO-Standalone). The wording lives in video/captions.md, the ONE file the recorded video and the
// live Story both read. The shared parser is vendored plain JS (server/src/story/, pinned by web/src/story/story.sha256); this file is the lab's own glue:
// it reads the file, parses it once, and answers GET /api/story. Nothing here makes a network call.
// @ts-expect-error the vendored parser is plain JavaScript, its shape is typed below
import { parseCaptions } from '../server/src/story/captions.js';

export interface StorySlide { title: string; lead: string; verdict: string; colA: { heading: string; lines: string[] }; colB: { heading: string; lines: string[] }; image: string | null; wide: boolean }
export interface StoryCaptions { opening: StorySlide; closing: StorySlide; slides: Record<string, StorySlide>; steps: Record<string, { title: string; text: string }> }

/** video/captions.md, one level up from src/ and from dist/ (the Dockerfile copies it to /app/video). */
export const CAPTIONS_PATH = fileURLToPath(new URL('../video/captions.md', import.meta.url));

let cached: StoryCaptions | null = null;

/** The wording, parsed once. A broken file throws a CaptionsError that names the problem; the route turns it into a 500 with that message. */
export function loadCaptions(path: string = CAPTIONS_PATH): StoryCaptions {
  if (path === CAPTIONS_PATH && cached) return cached;
  const parsed = parseCaptions(readFileSync(path, 'utf8')) as StoryCaptions;
  if (path === CAPTIONS_PATH) cached = parsed;
  return parsed;
}

export function resetCaptionsCache(): void { cached = null; }

/** GET /api/story: the wording only. No tenant, host or key is in captions.md (the repo is public), and nothing else is added. */
export function storyResponse(path: string = CAPTIONS_PATH): { status: number; body: StoryCaptions | { error: string } } {
  try { return { status: 200, body: loadCaptions(path) }; }
  catch (e) { return { status: 500, body: { error: `Story wording could not be read: ${e instanceof Error ? e.message : 'unknown error'}` } }; }
}

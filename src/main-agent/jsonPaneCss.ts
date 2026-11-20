import { readFileSync } from 'node:fs';

// The JsonPane CSS subset this page uses, inlined into its own <style> (rule 24
// token names mapped onto this page's dark palette).
export const JSON_PANE_CSS = readFileSync(
  new URL('./jsonPaneCss.css', import.meta.url),
  'utf8',
);

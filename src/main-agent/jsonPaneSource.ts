import { readFileSync } from 'node:fs';

// The browser script that renders the shared JsonPane (rule 24) on this server-rendered
// page: the Form | JSON toggle with the hybrid C+A Form view. The source of truth for
// its behavior is the comment header inside the script; the page inlines it as a
// classic script before the trace script that calls jsonPaneIfJson().
export const jsonPaneSource = readFileSync(
  new URL('./jsonPaneSource.browser.js', import.meta.url),
  'utf8',
);

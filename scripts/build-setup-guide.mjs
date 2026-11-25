#!/usr/bin/env node
// Builds the styled setup guide (docs/setup-guide/index.html) from docs/PRIVILEGE-SETUP.md, the one place the words live.
//   npm run build:guide        write docs/setup-guide/index.html and docs/setup-guide/PRIVILEGE-SETUP.md
// test/setupGuidePage.test.ts rebuilds in memory and fails if the committed page differs, so a guide edit without a rebuild cannot merge.
// Only structure is generated here: the words are the guide's own, the layout is assets/site.css (copied unchanged from the reference guide pages).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE_MD = join(root, 'docs', 'PRIVILEGE-SETUP.md');
export const OUT_DIR = join(root, 'docs', 'setup-guide');

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (s) => decode(s.replace(/<[^>]+>/g, ''));
const slug = (s) => text(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Numbered headings lose their numbers; "section N" wording in the guide becomes a link to that heading by name.
const RENAME = { 'When it does not work': 'Troubleshooting', 'Before you start': 'Before you begin' };
const REF = {
  4: ['The AWS agent', 'the AWS agent section'],
  5: ['Troubleshooting', 'Troubleshooting'],
  6: ['Running everything on one machine', 'Running everything on one machine'],
  7: ['What a script can and cannot do', 'What a script can and cannot do for you'],
};

// Inline icons (no icon font to fetch, so the header reads right offline). They keep the reference's .ms-icon class so its theme-toggle CSS applies.
const ICON = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  auto: ICON('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  light: ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dark: ICON('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  download: ICON('<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>').replace('width="18" height="18"', 'width="15" height="15"'),
};

const MARK =
  '<svg class="mark" width="30" height="30" viewBox="0 0 32 32" role="img" aria-label="Privilege A2A lab">' +
  '<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">' +
  '<circle cx="9.5" cy="16" r="5.5" stroke="currentColor"/><circle cx="22.5" cy="16" r="5.5" stroke="currentColor"/>' +
  '<path d="M15 16h2" stroke="#c8202f"/></g></svg>';

// A wording swap that finds nothing must fail the build, not pass silently with a stale sentence.
const must = (body, from, to) => {
  if (!body.includes(from)) throw new Error(`the guide no longer contains "${from}": update scripts/build-setup-guide.mjs`);
  return body.replace(from, to);
};

export function buildGuide(md) {
  // "section N" in the prose must still mean the heading numbered N in the source: check the table against the real numbers.
  const numbered = new Map([...md.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]]));
  for (const [n, [name]] of Object.entries(REF)) {
    const title = numbered.get(Number(n));
    if (title === undefined || !(RENAME[title] ?? title).startsWith(name)) {
      throw new Error(`the guide's section ${n} is "${title ?? 'missing'}", but "section ${n}" is mapped to "${name}": update REF in scripts/build-setup-guide.mjs`);
    }
  }
  for (const [n, title] of [[1, 'What you are building'], [3, 'Steps']]) {
    if (numbered.get(n) !== title) throw new Error(`the guide's section ${n} is "${numbered.get(n) ?? 'missing'}", expected "${title}": update the "section ${n}" swaps in scripts/build-setup-guide.mjs`);
  }
  let body = marked.parse(md, { gfm: true, async: false });

  body = body.replace(/<h2>3\. Steps<\/h2>\s*/, '');
  if (!/<h3>Step \d+\./.test(body)) throw new Error('the guide has no "### Step N." headings: update scripts/build-setup-guide.mjs');
  body = body.replace(/<h3>(Step \d+)\.\s*(.*?)<\/h3>/g, '<h2>$1: $2</h2>');
  body = body.replace(/<h2>(.*?)<\/h2>/g, (_m, t) => {
    const bare = t.replace(/^\d+\.\s*/, '');
    return `<h2>${RENAME[bare] ?? bare}</h2>`;
  });
  body = body.replaceAll('<table>', '<div class="table-wrap"><table>').replaceAll('</table>', '</table></div>');

  const toc = [];
  const seen = new Set();
  body = body.replace(/<h2>(.*?)<\/h2>/g, (_m, inner) => {
    const id = slug(inner);
    if (!id) throw new Error(`heading with no usable id: ${inner}`);
    if (seen.has(id)) throw new Error(`duplicate heading id: ${id}`);
    seen.add(id);
    toc.push([id, inner]);
    return `<h2 id="${id}"><a class="hl" href="#${id}" aria-label="Link to this section">#</a>${inner}</h2>`;
  });
  const idFor = (prefix) => {
    const hit = toc.find(([, t]) => text(t).startsWith(prefix));
    if (!hit) throw new Error(`no heading starts with "${prefix}"`);
    return hit[0];
  };

  body = must(body, 'Everything in sections 1 to 3 comes first.', 'Everything before this section comes first.');
  body = must(body, 'All of section 3', 'All nine steps');
  body = must(body, 'as in section 1', `as in <a href="#${idFor('What you are building')}">What you are building</a>`);
  body = must(body, 'every Privilege object in section 3 (', 'every Privilege object in the steps (');
  body = body.replace(/\b[Ss]ection (\d)\b/g, (m, n) => {
    const ref = REF[n];
    return ref ? `<a href="#${idFor(ref[0])}">${ref[1]}</a>` : m;
  });
  const stale = [...new Set(text(body).match(/\b[Ss]ection \d\b/g) ?? [])];
  if (stale.length) throw new Error(`the guide still says ${stale.join(', ')}: map it in scripts/build-setup-guide.mjs or reword it`);

  const title = /<h1>(.*?)<\/h1>/.exec(body)?.[1];
  if (!title) throw new Error('the guide has no h1');
  const tocHtml = toc.map(([id, t]) => `    <a href="#${id}" class="toc-h2">${t}</a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${attr(text(title))} - Privilege A2A lab</title>
<script>
  (function () {
    try {
      var t = localStorage.getItem('theme') || 'auto';
      if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);
    } catch (e) { /* storage blocked: follow the OS */ }
  })();
</script>
<link rel="stylesheet" href="assets/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
<header class="site-header"><div class="wrap-wide">
  <a class="brand" href="#" data-home>${MARK}Privilege A2A lab</a>
  <span class="spacer"></span>
  <span class="user">
    <button type="button" class="theme-toggle t-auto" title="Theme: auto (follows your system)" aria-label="Theme: auto (follows your system)">
      <span class="ms-icon">${ICONS.auto}</span>
      <span class="ms-icon">${ICONS.light}</span>
      <span class="ms-icon">${ICONS.dark}</span>
    </button>
  </span>
</div></header>

<main>
    <div class="wrap-wide doc">
      <article>
        <div class="doc-top">
          <nav class="crumbs"><a href="#" data-home>Privilege A2A lab</a><span class="dot"></span><span>Setup guide</span></nav>
          <span class="doc-top-actions">
            <a class="md-dl" href="PRIVILEGE-SETUP.md" title="Download this guide's markdown source"><span class="ms-icon">${ICONS.download}</span>Markdown</a>
          </span>
        </div>
${body}
      </article>

      <nav class="toc" aria-label="In this guide">
        <p class="toc-title">In this guide</p>
${tocHtml}
      </nav>
    </div>
</main>
<footer class="site-footer"><div class="wrap-wide">
  <span>Privilege A2A lab</span>
  <span>Setup guide</span>
</div></footer>
<script src="assets/site.js" defer></script>
<script src="assets/lab.js" defer></script>
</body></html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const page = buildGuide(readFileSync(GUIDE_MD, 'utf8'));
  writeFileSync(join(OUT_DIR, 'index.html'), page);
  copyFileSync(GUIDE_MD, join(OUT_DIR, 'PRIVILEGE-SETUP.md'));
  console.log(`wrote docs/setup-guide/index.html (${page.length} bytes)`);
}

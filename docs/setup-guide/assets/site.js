// Client-side behaviors for guide pages. Plain JS, no build step - served
// as-is at /assets/site.js. Each block is independent; order doesn't matter.
(function () {
  'use strict';

  // -- Theme toggle: light -> dark -> auto --------------------------------------
  // Tokens resolve via light-dark(), driven by color-scheme; [data-theme] on
  // <html> pins it (set pre-paint by the inline head script). Auto clears the
  // pin and follows the OS, repainting live when the OS setting changes.
  var themeBtn = document.querySelector('.theme-toggle');
  var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  var THEME_LABELS = { light: 'Theme: light', dark: 'Theme: dark', auto: 'Theme: auto (follows your system)' };

  function themeState() {
    var pinned = document.documentElement.getAttribute('data-theme');
    return (pinned === 'light' || pinned === 'dark') ? pinned : 'auto';
  }

  function applyThemeImg() {
    var dark = document.documentElement.getAttribute('data-theme')
      ? document.documentElement.getAttribute('data-theme') === 'dark'
      : mqDark.matches;
    document.querySelectorAll('img.theme-img[data-dark]').forEach(function (img) {
      var want = dark ? img.getAttribute('data-dark') : img.getAttribute('data-light');
      var have = img.getAttribute('src');
      if (want && have !== want) img.setAttribute('src', want);
    });
  }

  function refreshThemeBtn() {
    var s = themeState();
    themeBtn.className = 'theme-toggle t-' + s;
    themeBtn.title = THEME_LABELS[s];
    themeBtn.setAttribute('aria-label', THEME_LABELS[s]);
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = { light: 'dark', dark: 'auto', auto: 'light' }[themeState()];
      try {
        if (next === 'auto') localStorage.removeItem('theme');
        else localStorage.setItem('theme', next);
      } catch (e) { /* storage blocked: session-only override */ }
      if (next === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', next);
      refreshThemeBtn();
      applyThemeImg();
    });
    mqDark.addEventListener('change', function () {
      applyThemeImg(); // auto mode repaints via CSS; only the art needs JS
    });
    refreshThemeBtn();
    applyThemeImg();
  }

  // -- Mermaid: turn fenced mermaid blocks into diagrams ---------------------
  // (library loads from CDN only on pages that have one)
  var mermaidBlocks = document.querySelectorAll('article pre > code.language-mermaid');
  if (mermaidBlocks.length) {
    mermaidBlocks.forEach(function (code) {
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = code.textContent;
      code.parentNode.replaceWith(div);
    });
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
    s.onload = function () {
      // Mermaid colors can't use CSS variables (it inlines SVG attributes), so
      // pick the palette up from the custom properties at run time. Reading the
      // computed values (not matchMedia) means a toggle-pinned theme is honored.
      var css = getComputedStyle(document.documentElement);
      var v = function (name, fallback) { return css.getPropertyValue(name).trim() || fallback; };
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'loose',
        theme: 'base', fontFamily: "'Open Sans', sans-serif",
        themeVariables: {
          primaryColor: v('--surface', '#ffffff'), primaryBorderColor: v('--line-strong', '#d2d2d7'), primaryTextColor: v('--ink', '#1c1c1e'),
          lineColor: v('--faint', '#86868b'), secondaryColor: v('--th-bg', '#f5f5f7'), tertiaryColor: v('--surface', '#ffffff'),
          edgeLabelBackground: v('--surface', '#ffffff'), fontSize: '14px'
        },
        flowchart: { curve: 'basis', htmlLabels: true, padding: 14 }
      });
      window.mermaid.run({ querySelector: '.mermaid' });
    };
    document.head.appendChild(s);
  }

  // -- Right-hand ToC scroll-spy ------------------------------------------------
  // Highlight the section currently in view; plain top-of-section detection.
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var current = null;
    function spy() {
      var pos = window.scrollY + 90; // header + a little lead
      var best = null;
      tocLinks.forEach(function (a) {
        var h = document.getElementById(a.getAttribute('href').slice(1));
        if (h && h.offsetTop <= pos) best = a;
      });
      // Near page bottom, land on the last heading (short final sections)
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 40) best = tocLinks[tocLinks.length - 1];
      if (best !== current) {
        if (current) current.classList.remove('current');
        if (best) best.classList.add('current');
        current = best;
      }
    }
    document.addEventListener('scroll', spy, { passive: true });
    spy();
  }

  // -- Copy buttons for code blocks -------------------------------------------
  document.querySelectorAll('article pre').forEach(function (pre) {
    var wrap = document.createElement('div');
    wrap.className = 'codewrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    var b = document.createElement('button');
    b.className = 'copy';
    b.type = 'button';
    b.textContent = 'Copy';
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(pre.innerText).then(function () {
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1400);
      });
    });
    wrap.appendChild(b);
  });

  // -- Image lightbox: click an image to enlarge it, alt text as caption ------
  var lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.innerHTML = '<button class="lb-close" type="button" aria-label="Close">&#215;</button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(lb);
  var lbImg = lb.querySelector('img');
  var lbCap = lb.querySelector('figcaption');
  var lbClose = lb.querySelector('.lb-close');
  var lbReturn = null;

  function openLightbox(img) {
    lbReturn = img;
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt;
    lbCap.textContent = img.alt;
    lbCap.style.display = img.alt ? '' : 'none';
    lb.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    lbClose.focus();
  }

  function closeLightbox() {
    lb.classList.remove('open');
    document.documentElement.style.overflow = '';
    if (lbReturn) { lbReturn.focus(); lbReturn = null; }
  }

  document.querySelectorAll('article img').forEach(function (img) {
    img.addEventListener('click', function () { openLightbox(img); });
  });
  lb.addEventListener('click', function (e) {
    if (e.target === lb || e.target === lbImg) closeLightbox();
  });
  lbClose.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
  });
})();

// ---------------------------------------------------------------------------
// Admin disclosure tables (readers): the whole summary row is the toggle;
// the chevron rotates and the detail row beneath reveals the content.
// Feedback rows are excluded - they open a modal (admin-feedback.js).
// Event delegation: works for any number of rows.
(function () {
  document.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    var row = e.target.closest('.reader-row');
    if (!row) return;
    var detail = row.nextElementSibling;
    if (!detail || !detail.classList.contains('reader-detail')) return;
    var open = detail.hidden;
    detail.hidden = !open;
    row.classList.toggle('open', open);
    var th = row.querySelector('th');
    if (th) th.setAttribute('aria-expanded', String(open));
  });
})();

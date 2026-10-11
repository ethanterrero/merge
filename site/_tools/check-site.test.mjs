// Tests for check-site.mjs. Run with: node --test site/_tools/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite, listPlaceholders } from './check-site.mjs';

const DRAFT = '<p class="draft">Draft, pending review</p>';

function page({ title = 'Page', body = '', head = '', lang = ' lang="en"' } = {}) {
  return `<!doctype html>
<html${lang}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="styles.css">
${head}
</head>
<body>
${DRAFT}
<main><h1>${title}</h1>${body}</main>
</body>
</html>`;
}

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-site-'));
  writeFileSync(join(dir, 'styles.css'), 'body{}');
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function run(files) {
  const dir = site(files);
  try {
    return checkSite(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a clean site has no problems', () => {
  const problems = run({
    'index.html': page({ body: '<a href="privacy.html#data">Privacy</a> <a href="#top" id="top">Top</a>' }),
    'privacy.html': page({ title: 'Privacy', body: '<h2 id="data">Data</h2><a href="index.html">Home</a>' }),
  });
  assert.deepEqual(problems, []);
});

test('external links, mailto and tel are not resolved locally', () => {
  const problems = run({
    'index.html': page({
      body: '<a href="https://www.openstreetmap.org/copyright">OSM</a> <a href="mailto:a@b.c">m</a> <a href="tel:911">911</a>',
    }),
  });
  assert.deepEqual(problems, []);
});

test('a link to a missing page is reported', () => {
  const problems = run({ 'index.html': page({ body: '<a href="terms.html">Terms</a>' }) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /index\.html: link to missing file "terms\.html"/);
});

test('a link to a missing fragment is reported, on another page or the same page', () => {
  const problems = run({
    'index.html': page({ body: '<a href="privacy.html#nope">x</a> <a href="#gone">y</a>' }),
    'privacy.html': page({ title: 'Privacy' }),
  });
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /index\.html: link to missing anchor "privacy\.html#nope"/);
  assert.match(problems.join('\n'), /index\.html: link to missing anchor "#gone"/);
});

test('every page must carry the draft marker', () => {
  const problems = run({ 'index.html': page().replace(DRAFT, '') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /index\.html: missing the "Draft, pending review" marker/);
});

test('scripts are not allowed', () => {
  const problems = run({ 'index.html': page({ head: '<script>console.log(1)</script>' }) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /index\.html: contains a <script> tag/);
});

test('remote resources are not allowed (no trackers, fonts or pixels)', () => {
  const problems = run({
    'index.html': page({
      head: '<link rel="stylesheet" href="https://fonts.example.com/a.css">',
      body: '<img src="//pixel.example.com/p.gif" alt=""> <iframe src="https://example.com"></iframe>',
    }),
  });
  // The iframe is reported twice: as an iframe and for its remote src.
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /loads a remote resource "https:\/\/fonts\.example\.com\/a\.css"/);
  assert.match(problems.join('\n'), /loads a remote resource "\/\/pixel\.example\.com\/p\.gif"/);
  assert.match(problems.join('\n'), /contains an <iframe> tag/);
  assert.match(problems.join('\n'), /loads a remote resource "https:\/\/example\.com"/);
});

test('pages need a language, a viewport, a title and exactly one h1', () => {
  const problems = run({
    'index.html': page({ lang: '' })
      .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '')
      .replace('<title>Page</title>', '<title> </title>')
      .replace('<h1>Page</h1>', ''),
  });
  assert.deepEqual(
    problems.map((p) => p.replace(/^index\.html: /, '')).sort(),
    ['missing <html lang>', 'missing the viewport meta tag', 'missing a <title>', 'needs exactly one <h1> (found 0)'].sort(),
  );
});

test('duplicate ids on a page are reported', () => {
  const problems = run({ 'index.html': page({ body: '<p id="a">1</p><p id="a">2</p>' }) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /index\.html: duplicate id "a"/);
});

test('a missing stylesheet is reported like any missing file', () => {
  const dir = site({ 'index.html': page() });
  rmSync(join(dir, 'styles.css'));
  try {
    assert.match(checkSite(dir).join('\n'), /index\.html: link to missing file "styles\.css"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listPlaceholders returns each page\'s placeholders with what supplies them', () => {
  const dir = site({
    'index.html': page({
      body: '<span class="placeholder" data-fill="O-03">support@[domain]</span> <span class="placeholder" data-fill="D-12 counsel">[Governing law]</span>',
    }),
  });
  try {
    assert.deepEqual(listPlaceholders(dir), [
      { file: 'index.html', text: 'support@[domain]', fill: 'O-03' },
      { file: 'index.html', text: '[Governing law]', fill: 'D-12 counsel' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTML comments are ignored: their links, ids and placeholders don\'t count', () => {
  const dir = site({
    'index.html': page({
      body: '<!-- Values in <span class="placeholder"> are open; see <a href="gone.html">x</a> id="a" --><p id="a">1</p>',
    }),
  });
  try {
    assert.deepEqual(checkSite(dir), []);
    assert.deepEqual(listPlaceholders(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Checks the static pages in site/ (M-40). No dependencies; the pages are our own
// hand-written HTML, so simple pattern matching is enough.
//
//   node site/_tools/check-site.mjs site                 # fail on problems
//   node site/_tools/check-site.mjs site --placeholders  # also list what's left to fill
//
// Rules for every top-level .html file (HTML comments are ignored):
// - local links (href/src) point at a file that exists, and #anchors at an id on that page;
// - the page carries the "Draft, pending review" marker until owner and counsel approve;
// - no <script>, no <iframe>, and nothing loaded from another host (no trackers, fonts,
//   pixels or CDNs). Plain outbound links (<a href="https://...">) are fine;
// - <html lang>, a viewport meta tag, a non-empty <title>, exactly one <h1>, unique ids.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DRAFT_MARKER = 'Draft, pending review';

const isRemote = (url) => /^(https?:)?\/\//i.test(url);
const isNonFile = (url) => /^(mailto:|tel:|data:)/i.test(url);

function ids(html) {
  return [...html.matchAll(/\sid\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
}

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const read = (dir, file) => stripComments(readFileSync(join(dir, file), 'utf8'));

function pages(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort();
}

function checkPage(dir, file, html, idsByFile) {
  const problems = [];
  const say = (message) => problems.push(`${file}: ${message}`);

  if (!html.includes(DRAFT_MARKER)) say(`missing the "${DRAFT_MARKER}" marker`);
  if (/<script\b/i.test(html)) say('contains a <script> tag');
  if (/<iframe\b/i.test(html)) say('contains an <iframe> tag');
  if (!/<html\b[^>]*\slang\s*=\s*"[^"]+"/i.test(html)) say('missing <html lang>');
  if (!/<meta\b[^>]*name\s*=\s*"viewport"/i.test(html)) say('missing the viewport meta tag');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title || title[1].trim() === '') say('missing a <title>');
  const h1s = (html.match(/<h1\b/gi) ?? []).length;
  if (h1s !== 1) say(`needs exactly one <h1> (found ${h1s})`);

  const seen = new Set();
  for (const id of ids(html)) {
    if (seen.has(id)) say(`duplicate id "${id}"`);
    seen.add(id);
  }

  // Anything a tag loads by itself: src on any tag, href on <link>.
  for (const m of html.matchAll(/<(\w+)\b[^>]*?\s(src|href)\s*=\s*"([^"]*)"/gi)) {
    const [, tag, attr, url] = m;
    const loads = attr.toLowerCase() === 'src' || tag.toLowerCase() === 'link';
    if (loads && isRemote(url)) say(`loads a remote resource "${url}"`);
  }

  // Local links and their anchors.
  for (const m of html.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)) {
    const url = m[1];
    if (url === '' || isRemote(url) || isNonFile(url)) continue;
    const [path, fragment] = url.split('#');
    const target = path === '' ? file : path;
    if (path !== '' && !existsSync(join(dir, path))) {
      say(`link to missing file "${path}"`);
      continue;
    }
    if (fragment !== undefined && fragment !== '') {
      const targetIds = idsByFile.get(target);
      if (targetIds && !targetIds.has(fragment)) say(`link to missing anchor "${url}"`);
    }
  }
  return problems;
}

/** Returns every problem in the site's top-level pages, as "file: message" strings. */
export function checkSite(dir) {
  const html = new Map(pages(dir).map((file) => [file, read(dir, file)]));
  const idsByFile = new Map([...html].map(([file, text]) => [file, new Set(ids(text))]));
  return [...html].flatMap(([file, text]) => checkPage(dir, file, text, idsByFile));
}

/** Lists every <span class="placeholder" data-fill="..."> left on the pages. */
export function listPlaceholders(dir) {
  return pages(dir).flatMap((file) => {
    const html = read(dir, file);
    return [...html.matchAll(/<span class="placeholder"(?: data-fill="([^"]*)")?>([\s\S]*?)<\/span>/g)].map((m) => ({
      file,
      text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      fill: m[1] ?? '',
    }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'site';
  const problems = checkSite(dir);
  const placeholders = listPlaceholders(dir);
  if (process.argv.includes('--placeholders')) {
    for (const p of placeholders) console.log(`${p.file}\t${p.fill}\t${p.text}`);
  }
  console.log(`${pages(dir).length} pages, ${placeholders.length} placeholders left to fill.`);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log('No problems found.');
}

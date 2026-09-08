#!/usr/bin/env node
/**
 * One-time migration from frontmatter clocks to synced copies.
 *
 * For every document, every existing language is marked as synced to every
 * existing language as the files stand now: each real file is copied to
 * `.obelum/<viewer>/<its repository path>` at the repository root — the
 * viewer's checkout of the whole repository, one directory like `.git`.
 * The `rev`, `synced` and legacy `base` lines are stripped from every
 * frontmatter, and the copies hold the stripped bytes. Nothing else changes.
 * Review with `git status`, then commit.
 *
 *   node scripts/migrate-to-obelum-copies.mjs --root . --site examples/playground \
 *     --locales en,sv,de --default en [--unprefixed] \
 *     [--pages src/pages] [--partials src/partials] [--collections content] \
 *     [--collection staff=../../content-shared/staff]
 *
 * `--root` is the repository root (default: the site directory) and `--site`
 * the site directory, both relative to the working directory. `--unprefixed`
 * says the default locale's pages sit at the pages root (Astro's unprefixed
 * default locale) instead of in their own directory.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = name => args.includes(`--${name}`);
const site = opt('site');
const repoRoot = opt('root', site);
const locales = (opt('locales') ?? '').split(',').filter(Boolean);
const defaultLocale = opt('default', locales[0]);
const unprefixed = flag('unprefixed');
const pagesDir = opt('pages', 'src/pages');
const partialsDir = opt('partials', 'src/partials');
const collectionsDir = opt('collections', 'content');
const ownDirs = args.flatMap((a, i) => (a === '--collection' ? [args[i + 1]] : []))
  .map(s => { const [name, dir] = s.split('='); return { name, dir }; });
if (!site || locales.length < 1) {
  console.error('usage: --site <dir> --locales a,b,c [--default a] [--unprefixed] ...');
  process.exit(2);
}

const localeDir = lang => (unprefixed && lang === defaultLocale ? '' : lang);
const join = (...p) => p.filter(Boolean).join('/');

/** Every .mdx below `dir`, as paths relative to it, skipping dot- and _-dirs
 *  and, at the pages root of an unprefixed default locale, the other locales. */
function walk(dir, skip = []) {
  const out = [];
  const abs = path.join(site, dir);
  if (!fs.existsSync(abs)) return out;
  const visit = (rel) => {
    for (const e of fs.readdirSync(path.join(abs, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (!rel && skip.includes(e.name)) continue;
      const r = join(rel, e.name);
      if (e.isDirectory()) visit(r);
      else if (e.name.endsWith('.mdx')) out.push(r);
    }
  };
  visit('');
  return out;
}

/** Drop the clock lines from the frontmatter block, and nothing else. */
function strip(content) {
  // A byte-order mark stays where it was; the block starts after it.
  const bom = content.startsWith('﻿') ? '﻿' : '';
  if (bom) return bom + strip(content.slice(1));
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!m) return content;
  // A stripped key takes its block-style continuation lines with it:
  //   synced:
  //     no: 1
  const lines = [];
  let dropping = false;
  for (const l of m[1].split(/\r?\n/)) {
    if (/^(rev|synced|base):/.test(l)) { dropping = true; continue; }
    if (dropping && /^\s+\S/.test(l)) continue;
    dropping = false;
    lines.push(l);
  }
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const body = content.slice(m[0].length);
  // A block that held nothing but clocks goes away entirely, blank line after it included.
  if (lines.every(l => l.trim() === '')) return body.replace(/^(\r?\n)+/, '');
  return `---${nl}${lines.join(nl)}${nl}---${nl}` + body;
}

/** Content roots: [root, per-lang dir under it]. */
const roots = [
  { root: pagesDir, dir: lang => localeDir(lang), skipAtRoot: locales.map(localeDir).filter(Boolean) },
  { root: partialsDir, dir: lang => lang },
  ...fs.existsSync(path.join(site, collectionsDir))
    ? fs.readdirSync(path.join(site, collectionsDir), { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ root: join(collectionsDir, e.name), dir: lang => lang }))
    : [],
  ...ownDirs.map(({ dir }) => ({ root: dir, dir: lang => lang })),
];

let stripped = 0, copies = 0;
for (const { root, dir, skipAtRoot = [] } of roots) {
  // rel path → { lang → stripped content }
  const docs = new Map();
  for (const lang of locales) {
    const d = dir(lang);
    for (const rel of walk(join(root, d), d ? [] : skipAtRoot)) {
      const file = path.join(site, join(root, d, rel));
      const before = fs.readFileSync(file, 'utf8');
      const after = strip(before);
      if (after !== before) { fs.writeFileSync(file, after); stripped++; }
      if (!docs.has(rel)) docs.set(rel, new Map());
      docs.get(rel).set(lang, after);
    }
  }
  for (const [rel, byLang] of docs) {
    for (const viewer of byLang.keys()) {
      for (const [viewed, content] of byLang) {
        const real = path.join(site, join(root, dir(viewed), rel));
        const copy = path.join(repoRoot, '.obelum', viewer, path.relative(repoRoot, real));
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.writeFileSync(copy, content);
        copies++;
      }
    }
  }
}
console.log(`stripped clocks from ${stripped} files, wrote ${copies} synced copies`);

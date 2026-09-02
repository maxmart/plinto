# Plinto playground — Driftwood

A small, fully runnable plinto site: three locales, ten blocks, and a content
corpus authored to be *deliberately divergent* across languages. It is three
things at once:

1. **The example site.** `npm run dev` here gives a clickable admin
   (`/plinto/admin`) with no private sites present, and the whole directory is
   publishable — no brand, no commercial content, no shared design system.
2. **A fixture corpus.** `packages/admin/src/mdx/__tests__/`
   `playground-corpus.test.ts` opens every document here the way the editor
   opens it and writes it back the way a save writes it. The files ship
   canonicalized, so the round trip must not move a byte.
3. **The reachability guard.** The block registry is real and its richtext
   fields are exercised: with an empty fixture registry, `isRichtextField`
   answers false everywhere and the markdown ⇄ HTML conversion — the code
   that has destroyed content three separate times — never runs in any test.
   This corpus exists to keep that path reachable.

## Running it

```sh
npm install          # at the repository root
cd examples/playground
npm run dev          # site at /en/, admin at /plinto/admin
```

Restart the dev server after touching `src/plinto-blocks.tsx` or
`astro.config.mjs` — the virtual config is baked at startup.

## The site

English (default, URL-prefixed — `src/pages/en/` exists, which is what makes
it so), Swedish, German. Everything follows the conventions: the only
required plinto config is the git CORS proxy and the block registry path.
The blocks (`src/blocks/`) are generic and nobody's brand:

| Block | Exercises |
| --- | --- |
| `Prose`, `Callout` | `children: richtext(...)` bodies — the dangerous conversion |
| `Testimonial` | a richtext field under another name (`quote`) |
| `Hero` | `mediaPicker()` + `pageLink()` on one block |
| `Figure` | `mediaPicker()` |
| `LinkButton` | `pageLink()` |
| `Columns` / `Column` | slot fields (Puck DropZones, incl. the `[class*="DropZone"]` grid rule) |
| `Faq` | the hydrated island: `.astro` wrapper in `astroBlocks`, array field |
| `NavBar` | array fields; lives in the TopBar partial |

No block declares an `id` field (Puck owns `props.id`), and no default prop
selects content.

## The divergence matrix

Each case the translation work needs, and the document that demonstrates it.
The `rev` / `synced` vector clocks are honest: they tell the same story the
content does, and the admin's Sync buttons light up exactly where they say.

This matrix is executable: `packages/core/src/agents/__tests__/`
`translation-evals.test.ts` seeds these documents into a real temporary git
repository and runs the translation agent's whole pipeline over them, asking
the minimal-edit question — when a source locale is edited, does the sync
leave the target's own drift alone? The deterministic halves (the diff the
agent is shown, the sync stamping, the rules that would catch a destructive
rewrite) run on every `npm test`; the agent itself runs live when
`ANTHROPIC_API_KEY` is set, and replays its recorded transcript when not.

| Case | Where | The story |
| --- | --- | --- |
| Divergent length | `index` | `en`/`sv` spell the welcome out over three paragraphs and a column row; `de` (rev 2, behind `en`@4 and `sv`@3 — **stale**) summarises it in one. |
| Frontmatter divergence | `index` | Three different titles and descriptions ("Driftwood — notes from small islands" / "Drivved — anteckningar…" / "Driftwood — Inselnotizen"). |
| Parity control | `about` | All three at rev 2 with full synced maps — identical in meaning, block for block. The control the other cases are read against. |
| Reordered blocks | `islands` | Same three blocks everywhere, but `sv` puts the column row first and the intro last. Everyone synced: reordering is an editorial fact, not staleness. |
| Mid-conflict | `visiting` | `en`@5 has not seen `sv`@4 and vice versa — concurrent edits, each stale with respect to the other. `en`'s rev-5 edit is the second intro paragraph (tell the harbour office); `sv`'s rev-4 edit is the testimonial. |
| Target-only block | `visiting` | `sv` has the Lindqvist `Testimonial` that `en` lacks (and `sv`'s FAQ has a third question `de` lacks). |
| Source-only block | `packing` | `en` has the "Winter crossings" `Callout`; `de` saw `en`@3 (synced says so) and deliberately dropped it. Divergence with everyone synced — an editorial decision, not a translation gap. |
| Different block type, same intent | `fares` | `en`/`sv` open with a `Hero`; `de` opens with a `Prose` heading and a `Columns` row instead. |
| Untranslatable content | `fares`, `field-notes` | The fares table (numbers and route names identical in all three languages) and the tide-clock code fence ("do not translate the code"). |
| Locale-only page | `sv/skargarden` | Exists only in Swedish (`rev: 1, synced: {}`); `en`/`de` are *missing*, which tests creation rather than edit. Only the Swedish TopBar links to it. |
| `lang:` override | `en/hallig-brief` | A German guest letter published on the English locale: frontmatter `lang: de` puts `de` on `<html lang>` while the route stays `/en/…`. |

The partials diverge too: the TopBars are at `en`/`sv` rev 2 with `de` created
from them at rev 1, and the Swedish TopBar carries the extra `Skärgården`
link.

## The dangerous shapes

`field-notes` (all three locales, at parity) holds, inside richtext bodies,
every shape that has actually broken the editor round trip:

- a **GFM table** (the tide table — once flattened into loose cells)
- an **ordered list with nested content** (nested bullets *and* a nested
  ordered list — once detached from their parents)
- an **inline image** inside richtext (`![…](/media/lighthouse.svg)`)
- a typed **`<`** in prose (`anything \< 10 °C` — once produced a file that
  could not be reopened)
- a **code fence** inside a `Callout` body
- **non-ASCII** throughout (å ä ö ü ß — Åsvik, öre, Küstensommer, größe)

The corpus test asserts these shapes are still present *after* parsing — if
an edit here removes the last table or nested list, the test says so rather
than quietly testing less.

## What canonical means

Every `.mdx` file here is the generator's own output: parse it, regenerate
it, and you get the same bytes. That is what makes "open a page in the
editor, save, `git diff`" come back clean — verified against a real editor
save, not just the test. If you author a new document by hand, expect the
first save to re-spell it (quote style, prop layout, indentation) once.

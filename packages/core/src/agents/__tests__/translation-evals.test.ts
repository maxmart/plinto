/**
 * Minimal-edit evals for the translation agent.
 *
 * The question every scenario asks: when a source locale is edited and the
 * target has structurally drifted, does the agent make a minimal, surgical
 * edit — or does it rewrite the document and destroy the target's independent
 * editorial work? The scenarios are the playground's divergence matrix
 * (examples/playground/README.md): a target-only block, reordered blocks, a
 * target that summarises, a locale-only page, and content that must not be
 * translated.
 *
 * Three layers, so the suite is meaningful with or without an API key:
 *
 *  1. DETERMINISTIC, every run: the pipeline probes. A scenario is built in a
 *     real temporary git repository, the edit lands through the real
 *     editContent, and runTranslation runs with a driver that records the
 *     prompts and makes no edits — asserting the agent is shown a minimal
 *     diff (and no sync metadata), and that saving stamps syncContent
 *     semantics: the target's rev unchanged, synced.<source> advanced.
 *  2. DETERMINISTIC, every run: the rules' own teeth. Every failure mode the
 *     evals exist to catch — a dropped target-only block, a wholesale
 *     rewrite, a reorder, a reworded untouched paragraph — is constructed
 *     by hand from real corpus bytes and must be *caught*, and the surgical
 *     fix must pass. A checker nothing can fail is decoration.
 *  3. GATED: the agent itself. With ANTHROPIC_API_KEY set the real model
 *     runs (and its transcript is recorded to fixtures/translation-evals/
 *     when none exists, or when PLINTO_EVAL_RECORD=1). Without a key,
 *     recorded transcripts replay through the real tool-application loop —
 *     and refuse to run against prompts they were not recorded from. A
 *     scenario with neither key nor fixture is skipped, visibly.
 *
 * To record the fixtures: ANTHROPIC_API_KEY=… npx vitest run translation-evals
 * (add PLINTO_EVAL_RECORD=1 to re-record ones that already exist).
 */
import { runTranslation } from '../translate';
import { driveClaudeAgent, type DriveFn } from '@obelum/translator-claude';
import { parseSyncMeta, stripSyncMetadataLines } from '../../sync-meta';
import {
  parseEvalDoc, reassemble, minimalEditViolations, creationViolations,
} from './eval-doc';
import {
  buildScenario, probeDriver, replayDriver, recordingDriver, runLog,
  hasFixture, loadTranscript, saveTranscript, fixturePath, shippedDoc,
  type Scenario, type ScenarioSpec, type EvalDriver, type Transcript,
} from './eval-harness';

// ---------------------------------------------------------------------------
// The seam: driveClaudeAgent, and nothing else. The tool-application loop,
// the diff gathering, the ops layer and the git history stay real.
// ---------------------------------------------------------------------------

// Installed per test and handed to runTranslation as the `drive` option:
// the translator runs its real prompt building, tool loop and save rule,
// and only what talks to the model is replaced.
let current: EvalDriver | null = null;
const drive: DriveFn = opts => {
  if (!current) throw new Error('translation evals: no driver installed for this test');
  return current(driveClaudeAgent, opts);
};
const useDriver = (driver: EvalDriver) => { current = driver; };
afterEach(() => { current = null; });

const API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

const stripClocks = (content: string) => stripSyncMetadataLines(content.split('\n')).join('\n');

// ---------------------------------------------------------------------------
// The scenarios — the playground's divergence matrix, exercised
// ---------------------------------------------------------------------------

interface EvalCase {
  spec: ScenarioSpec;
  /** What the surgical fix to the target looks like — feeds the rules' own
   *  self-tests, not the agent. */
  goodFix: { find: string; replace: string };
  /** Scenario-specific bytes that must survive in the target, verbatim. */
  mustSurvive?: string[];
}

const CASES: EvalCase[] = [
  {
    // Target-only block + accepted drift: sv has the Lindqvist Testimonial en
    // lacks, and en has a second intro paragraph sv chose not to carry. Both
    // are seeded as *synced* — editorial facts, not staleness — and must
    // survive an en edit untouched.
    spec: {
      name: 'visiting-surgical-edit',
      page: 'visiting',
      target: 'sv',
      seed: ['en', 'sv', 'de'],
      edit: {
        lang: 'en',
        find: 'June is polite, July is crowded, August is the local secret.',
        replace: 'June is polite, July is crowded, August is the local secret nobody keeps.',
      },
    },
    goodFix: {
      find: 'Juni är artig, juli är trång, augusti är den lokala hemligheten.',
      replace: 'Juni är artig, juli är trång, augusti är den lokala hemligheten som ingen håller.',
    },
    mustSurvive: [
      // The target-only Testimonial, and the drift-shaped Prose that must not
      // grow en's second paragraph.
      'Vi kom för en helg och stannade i nio dagar.',
      'Familjen Lindqvist',
    ],
  },
  {
    // Reordered blocks: sv puts the column row first and the intro last.
    // The order is the target's editorial fact; syncing an en edit must not
    // "fix" it back to en's order.
    spec: {
      name: 'islands-reordered-target',
      page: 'islands',
      target: 'sv',
      seed: ['en', 'sv', 'de'],
      edit: {
        lang: 'en',
        find: 'one that welcomes you, one that tolerates you',
        replace: 'one that welcomes you, one that merely tolerates you',
      },
    },
    goodFix: {
      find: 'en som välkomnar dig, en som tolererar dig',
      replace: 'en som välkomnar dig, en som bara tolererar dig',
    },
    mustSurvive: ['Den vänliga. Kafé på kajen, sängar ovanpå affären.'],
  },
  {
    // A target that summarises: de compresses en's three-paragraph welcome
    // (and its Columns row) into one paragraph. The summary may be updated;
    // it must not be replaced by a translation of en's full structure.
    spec: {
      name: 'index-summarising-target',
      page: 'index',
      target: 'de',
      seed: ['en', 'sv', 'de'],
      edit: {
        lang: 'en',
        find: 'They are opinionated, occasionally out of date, and written from the quay',
        replace: 'They are opinionated, salt-stained, occasionally out of date, and written from the quay',
      },
    },
    goodFix: {
      find: 'eigensinnig, gelegentlich veraltet',
      replace: 'eigensinnig, salzfleckig, gelegentlich veraltet',
    },
  },
  {
    // Content that must NOT be translated: the tide table's numbers, the
    // Åsvik proper noun, and the code fence the Callout says outright not to
    // translate. The edit is prose one paragraph away from all of them.
    spec: {
      name: 'field-notes-untranslatables',
      page: 'field-notes',
      target: 'sv',
      seed: ['en', 'sv', 'de'],
      edit: {
        lang: 'en',
        find: 'The rule of thumb from the Åsvik pilots:',
        replace: 'The old rule of thumb from the Åsvik pilots:',
      },
    },
    goodFix: {
      find: 'Tumregeln från lotsarna i Åsvik:',
      replace: 'Den gamla tumregeln från lotsarna i Åsvik:',
    },
    mustSurvive: [
      '| Aldra quay | 06:41 | 12:58 | 0.4 m |',
      'def next_high(now, station):',
      '# lunar day: 24 h 50 min, halved for the semi-diurnal tide',
      'lotsarna i Åsvik',
    ],
  },
];

// Locale-only page: sv/skargarden exists only in Swedish (rev 1, synced {}).
// Translating it into en is creation, not edit — full-sync mode, write_file.
const CREATION: ScenarioSpec = {
  name: 'skargarden-locale-only-creation',
  page: 'skargarden',
  target: 'en',
  seed: ['sv'],
  seedOverrides: { sv: { rev: 1, synced: {} } },
};

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

/** The en-diff section of the user message the agent was (or would be) sent. */
function diffSectionOf(userMessage: string, sourceLang: string): string {
  const marker = `## Changes made to ${sourceLang} since then:\n`;
  expect(userMessage).toContain(marker);
  return userMessage.split(marker)[1].split('\n\n## ')[0];
}

/** syncContent semantics: the target's own rev untouched, every source's
 *  current rev incorporated — the edited language's advanced, the others as
 *  they were. */
function expectSyncStamps(scenario: Scenario, after: string) {
  const { spec } = scenario;
  const before = parseSyncMeta(scenario.targetBefore ?? '');
  const meta = parseSyncMeta(after);
  expect(meta.rev).toBe(before.rev);
  if (spec.edit) expect(meta.synced[spec.edit.lang]).toBe(2);
  for (const lang of spec.seed) {
    if (lang === spec.target || lang === spec.edit?.lang) continue;
    expect(meta.synced[lang]).toBe(1);
  }
}

// ---------------------------------------------------------------------------
// 1. The deterministic pipeline, per scenario
// ---------------------------------------------------------------------------

describe.each(CASES)('pipeline: $spec.name', ({ spec }) => {
  it('shows the agent a minimal diff and stamps syncContent semantics', async () => {
    const scenario = await buildScenario(spec);
    try {
      const captured: { system?: string; userMessage?: string } = {};
      useDriver(probeDriver(captured));
      const log = runLog();

      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: 'probe', drive },
        log.callbacks,
      );
      expect(result).toBe('done');
      expect(log.statuses).toEqual(['translating', 'saving', 'done']);

      // Diff mode was reached — the target's synced clock found the base
      // revision in real history — and only the edited language contributes.
      const source = spec.edit!.lang;
      expect(captured.system).toContain(`changes were made in: ${source}`);
      for (const lang of spec.seed) {
        if (lang === source) continue;
        expect(captured.userMessage).not.toContain(`## Changes made to ${lang}`);
      }

      // The diff is the edit and nothing else: one line out, one line in.
      const diff = diffSectionOf(captured.userMessage!, source);
      const removed = diff.split('\n').filter(l => l.startsWith('-'));
      const added = diff.split('\n').filter(l => l.startsWith('+'));
      expect(removed).toHaveLength(1);
      expect(added).toHaveLength(1);
      expect(removed[0]).toContain(spec.edit!.find);
      expect(added[0]).toContain(spec.edit!.replace);

      // Sync metadata is bookkeeping, not translatable content: the model
      // must never see a rev change and report it as an edit.
      expect(captured.userMessage).not.toContain('synced:');
      expect(captured.userMessage).not.toMatch(/^rev: \d/m);
      expect(captured.system).not.toContain('synced:');

      // The probe made no edits, so the save is the pure stamping path:
      // the body untouched byte for byte, the clocks per syncContent.
      const after = scenario.read(spec.target)!;
      expect(stripClocks(after)).toBe(stripClocks(scenario.targetBefore!));
      expectSyncStamps(scenario, after);
    } finally {
      scenario.dispose();
    }
  });
});

describe(`pipeline: ${CREATION.name}`, () => {
  it('asks for creation via full sync, and refuses to save an empty result', async () => {
    const scenario = await buildScenario(CREATION);
    try {
      const captured: { system?: string; userMessage?: string } = {};
      useDriver(probeDriver(captured));
      const log = runLog();

      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: CREATION.target, apiKey: 'probe', drive },
        log.callbacks,
      );

      // No sync point and no target: full-sync mode, told to create the file.
      expect(captured.system).toContain('does not exist yet');
      expect(captured.system).toContain('write_file');
      expect(captured.userMessage).toContain('## Current sv content');
      expect(captured.userMessage).not.toContain('synced:');

      // A run that produced nothing must not be saved — an empty en page
      // stamped as synced would hide that anything went wrong.
      expect(result).toBe('error');
      expect(scenario.read('en')).toBeNull();
      expect(scenario.read('sv')).toBe(scenario.seeded.sv);
    } finally {
      scenario.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The rules' own teeth — every failure mode constructed, and caught
// ---------------------------------------------------------------------------

describe('the minimal-edit rules', () => {
  // Pure corners from shipped corpus bytes: the rules ignore the clocks, so
  // no repository is needed to prove what they catch.
  const corners = (c: EvalCase) => {
    const sourceBase = shippedDoc(`src/pages/${c.spec.edit!.lang}/${c.spec.page}.mdx`);
    return {
      sourceBase,
      sourceCurrent: sourceBase.replace(c.spec.edit!.find, c.spec.edit!.replace),
      targetBefore: shippedDoc(`src/pages/${c.spec.target}/${c.spec.page}.mdx`),
    };
  };
  const visiting = CASES[0];
  const islands = CASES[1];
  const fieldNotes = CASES[3];

  it('reassembles a parsed document byte-identically (the surgery the bad cases use is sound)', () => {
    for (const rel of ['src/pages/sv/visiting.mdx', 'src/pages/sv/islands.mdx']) {
      const source = shippedDoc(rel);
      const doc = parseEvalDoc(source);
      expect(reassemble(source, doc, doc.blocks.map(b => b.id))).toBe(source);
    }
  });

  it.each(CASES)('accepts the surgical fix: $spec.name', c => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(c);
    const targetAfter = targetBefore.replace(c.goodFix.find, c.goodFix.replace);
    expect(targetAfter).not.toBe(targetBefore);
    expect(minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent })).toEqual([]);
  });

  it('catches a dropped target-only block', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(visiting);
    const doc = parseEvalDoc(targetBefore);
    const withoutTestimonial = doc.blocks.map(b => b.id).filter(id => id !== 'test-6b1f4d8a');
    const targetAfter = reassemble(targetBefore, doc, withoutTestimonial)
      .replace(visiting.goodFix.find, visiting.goodFix.replace);
    const violations = minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent });
    expect(violations.join('\n')).toContain('block id lost from the target: test-6b1f4d8a');
  });

  it('catches a wholesale rewrite that replaces the target with the source\'s structure', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(visiting);
    // The catastrophic outcome: the agent "translated the page" instead of
    // applying the diff — target-only work gone, drift "repaired".
    const violations = minimalEditViolations({
      targetBefore, targetAfter: sourceCurrent, sourceBase, sourceCurrent,
    });
    expect(violations.join('\n')).toContain('test-6b1f4d8a');
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it('catches a reorder of the target\'s blocks', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(islands);
    const doc = parseEvalDoc(targetBefore);
    // sv deliberately leads with the Columns row; "fixing" it to en's
    // Prose-first order is the destruction, not the sync.
    const enOrder = [...doc.blocks.map(b => b.id)].reverse();
    const targetAfter = reassemble(targetBefore, doc, enOrder)
      .replace(islands.goodFix.find, islands.goodFix.replace);
    const violations = minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent });
    expect(violations.join('\n')).toContain('block order changed');
  });

  it('catches a rewrite of an untouched block', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(visiting);
    const targetAfter = targetBefore
      .replace(visiting.goodFix.find, visiting.goodFix.replace)
      .replace('**Vindens veto.**', '**Vindens vetorätt.**');
    const violations = minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent });
    expect(violations.join('\n')).toContain('call-2d7b9e4f');
  });

  it('catches paragraphs changed beyond the source\'s edit', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(fieldNotes);
    const targetAfter = targetBefore
      .replace(fieldNotes.goodFix.find, fieldNotes.goodFix.replace)
      // Same block as the legitimate fix — but the source changed one
      // paragraph, and this rewords a second.
      .replace('Före varje dopp, i ordning:', 'Innan varje dopp, i ordning:');
    const violations = minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent });
    expect(violations.join('\n')).toContain('pros-7c4a9e2f');
    expect(violations.join('\n')).toContain('paragraphs changed');
  });

  it('catches frontmatter changed without a source change', () => {
    const { sourceBase, sourceCurrent, targetBefore } = corners(visiting);
    const targetAfter = targetBefore
      .replace(visiting.goodFix.find, visiting.goodFix.replace)
      .replace('title: Att besöka en ö', 'title: Besöka en ö');
    const violations = minimalEditViolations({ targetBefore, targetAfter, sourceBase, sourceCurrent });
    expect(violations.join('\n')).toContain('frontmatter key changed in the target without a source change: title');
  });

  it('creation: accepts a same-structure translation and catches a dropped block', () => {
    const source = shippedDoc('src/pages/sv/skargarden.mdx');
    // Structure-preserving "translation" (the words are not the rules'
    // business): same blocks, ids, imports, layout.
    expect(creationViolations(source, source.replace('För oss som bor här', 'For those of us who live here'))).toEqual([]);

    const doc = parseEvalDoc(source);
    const dropped = reassemble(source, doc, doc.blocks.map(b => b.id).filter(id => id !== 'call-7a3e9c5b'));
    expect(creationViolations(source, dropped).join('\n')).toContain('blocks differ');
  });
});

// ---------------------------------------------------------------------------
// 2b. The replay machinery itself, on a scripted transcript. Until a real
// fixture is recorded the replay path would otherwise never execute — and a
// path no test reaches is where this repo's worst bugs have lived. This is
// not an agent eval: it proves the transcript plumbing drives the real
// tool-application loop, that prompts are deterministic across scenario
// builds (what makes recorded fixtures replayable at all), and that both
// honesty guards actually fire.
// ---------------------------------------------------------------------------

describe('the replay machinery', () => {
  const { spec, goodFix } = CASES[0];

  /** The prompts this scenario deterministically produces, captured from a
   *  scenario built and probed just for that. */
  async function capturedPrompts(): Promise<{ system: string; userMessage: string }> {
    const scenario = await buildScenario(spec);
    try {
      const captured: { system?: string; userMessage?: string } = {};
      useDriver(probeDriver(captured));
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: 'probe', drive },
        runLog().callbacks,
      );
      expect(result).toBe('done');
      return { system: captured.system!, userMessage: captured.userMessage! };
    } finally {
      scenario.dispose();
    }
  }

  const scripted = (prompts: { system: string; userMessage: string }, steps: Transcript['steps']): Transcript =>
    ({ scenario: 'scripted', recordedAt: 'scripted', ...prompts, steps });

  it('replays a transcript through the real tool-application loop', async () => {
    const prompts = await capturedPrompts();
    const transcript = scripted(prompts, [
      {
        event: {
          type: 'tool_use', id: 'scripted-1', name: 'edit_file', turn: 0,
          input: { old_string: goodFix.find, new_string: goodFix.replace },
        },
        reply: { content: 'Edit applied successfully.' },
      },
      { event: { type: 'stop', reason: 'end_turn' } },
    ]);

    // A second build of the same scenario produces the same prompts — the
    // property every recorded fixture stands on — and the scripted edit
    // lands through the real applyTextEdit, is saved through the real
    // syncContent, and satisfies the minimal-edit rules.
    const scenario = await buildScenario(spec);
    try {
      useDriver(replayDriver(transcript));
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: 'replay', drive },
        runLog().callbacks,
      );
      expect(result).toBe('done');

      const after = scenario.read(spec.target)!;
      expect(after).toContain(goodFix.replace);
      expect(minimalEditViolations({
        targetBefore: scenario.targetBefore!,
        targetAfter: after,
        sourceBase: scenario.sourceBase!,
        sourceCurrent: scenario.sourceCurrent!,
      })).toEqual([]);
      expectSyncStamps(scenario, after);
    } finally {
      scenario.dispose();
    }
  });

  it('refuses a transcript recorded against different prompts', async () => {
    const prompts = await capturedPrompts();
    const stale = scripted({ ...prompts, userMessage: prompts.userMessage + '\nedited since' }, [
      { event: { type: 'stop', reason: 'end_turn' } },
    ]);
    const scenario = await buildScenario(spec);
    try {
      useDriver(replayDriver(stale));
      const log = runLog();
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: 'replay', drive },
        log.callbacks,
      );
      expect(result).toBe('error');
      expect(log.items.map(i => JSON.stringify(i)).join('\n')).toContain('stale fixture');
    } finally {
      scenario.dispose();
    }
  });

  it('notices when the tool loop diverges from the recording', async () => {
    const prompts = await capturedPrompts();
    // The recorded run saw this edit succeed; against the current corpus it
    // cannot — so the loop's live reply differs from the recorded one, and
    // the replay must refuse rather than quietly asserting on a run that
    // never happened.
    const divergent = scripted(prompts, [
      {
        event: {
          type: 'tool_use', id: 'scripted-1', name: 'edit_file', turn: 0,
          input: { old_string: 'text that is not in the target file', new_string: 'anything' },
        },
        reply: { content: 'Edit applied successfully.' },
      },
      { event: { type: 'stop', reason: 'end_turn' } },
    ]);
    const scenario = await buildScenario(spec);
    try {
      useDriver(replayDriver(divergent));
      const log = runLog();
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: 'replay', drive },
        log.callbacks,
      );
      expect(result).toBe('error');
      expect(log.items.map(i => JSON.stringify(i)).join('\n')).toContain('diverged');
    } finally {
      scenario.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The agent — live with a key, replayed from its recorded run without one
// ---------------------------------------------------------------------------

/**
 * Live when a key is present (recording the transcript when none exists, or
 * when PLINTO_EVAL_RECORD=1); replay when a fixture exists; skipped —
 * visibly — when there is neither.
 */
function agentDriver(name: string): { mode: 'live' | 'replay' | 'skip'; install?: () => void; finish?: () => void } {
  if (API_KEY) {
    let recorded: Omit<Transcript, 'scenario' | 'recordedAt'> | undefined;
    return {
      mode: 'live',
      install: () => useDriver(recordingDriver(t => { recorded = t; })),
      // Saved before the assertions run: a real transcript that fails the
      // eval is a finding worth keeping, and replaying it must fail too.
      finish: () => {
        if (recorded && (!hasFixture(name) || process.env.PLINTO_EVAL_RECORD)) saveTranscript(name, recorded);
      },
    };
  }
  if (hasFixture(name)) {
    return { mode: 'replay', install: () => useDriver(replayDriver(loadTranscript(name))) };
  }
  return { mode: 'skip' };
}

describe.each(CASES)('agent: $spec.name', ({ spec, mustSurvive }) => {
  const driver = agentDriver(spec.name);
  const run = driver.mode === 'skip' ? it.skip : it;

  run(`makes a minimal, surgical edit (${driver.mode === 'skip' ? `no fixture at ${fixturePath(spec.name)} and no ANTHROPIC_API_KEY` : driver.mode})`, async () => {
    const scenario = await buildScenario(spec);
    try {
      driver.install!();
      const log = runLog();
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: spec.target, apiKey: API_KEY || 'replay', drive },
        log.callbacks,
      );
      driver.finish?.();

      expect(result, log.items.map(i => JSON.stringify(i)).join('\n')).toBe('done');
      const after = scenario.read(spec.target)!;

      // The whole point: the shape of the diff the agent left behind.
      expect(minimalEditViolations({
        targetBefore: scenario.targetBefore!,
        targetAfter: after,
        sourceBase: scenario.sourceBase!,
        sourceCurrent: scenario.sourceCurrent!,
      })).toEqual([]);

      // And the corresponding block DID change — an agent that does nothing
      // at all also produces a beautifully minimal diff.
      expect(stripClocks(after)).not.toBe(stripClocks(scenario.targetBefore!));

      for (const bytes of mustSurvive ?? []) {
        expect(after).toContain(bytes);
      }

      expectSyncStamps(scenario, after);
    } finally {
      scenario.dispose();
    }
  }, 600_000);
});

describe(`agent: ${CREATION.name}`, () => {
  const driver = agentDriver(CREATION.name);
  const run = driver.mode === 'skip' ? it.skip : it;

  run(`creates the missing locale without touching the source (${driver.mode === 'skip' ? `no fixture at ${fixturePath(CREATION.name)} and no ANTHROPIC_API_KEY` : driver.mode})`, async () => {
    const scenario = await buildScenario(CREATION);
    try {
      driver.install!();
      const log = runLog();
      const result = await runTranslation(
        scenario.deps,
        { contentPath: scenario.contentPath, targetLang: 'en', apiKey: API_KEY || 'replay', drive },
        log.callbacks,
      );
      driver.finish?.();

      expect(result, log.items.map(i => JSON.stringify(i)).join('\n')).toBe('done');

      // The source is not the agent's to touch, byte for byte.
      expect(scenario.read('sv')).toBe(scenario.seeded.sv);

      // The created page copies the source's structure: blocks, ids, order,
      // imports, layout. Only the words are new.
      const created = scenario.read('en')!;
      expect(creationViolations(scenario.seeded.sv, created)).toEqual([]);

      // Creation stamping: a page that never had a revision starts where
      // syncContent's bookkeeping puts a translated file — rev untouched
      // (0 for a file that had none), the source's current rev incorporated.
      const meta = parseSyncMeta(created);
      expect(meta.rev).toBe(0);
      expect(meta.synced.sv).toBe(1);
    } finally {
      scenario.dispose();
    }
  }, 600_000);
});

// ---------------------------------------------------------------------------
// Suite hygiene: the corpus the scenarios stand on must actually be there.
// ---------------------------------------------------------------------------

it('the playground corpus backs every scenario', () => {
  for (const spec of [...CASES.map(c => c.spec), CREATION]) {
    for (const lang of spec.seed) {
      // parseEvalDoc refuses what it cannot read — a corpus edit that breaks
      // a scenario's document fails here by name, not in a diff assertion.
      const doc = parseEvalDoc(shippedDoc(`src/pages/${lang}/${spec.page}.mdx`));
      expect(doc.blocks.length).toBeGreaterThan(0);
      if (spec.edit && lang === spec.edit.lang) {
        const source = shippedDoc(`src/pages/${lang}/${spec.page}.mdx`);
        expect(source).toContain(spec.edit.find);
      }
    }
  }
});

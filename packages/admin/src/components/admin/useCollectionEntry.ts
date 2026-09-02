import { useMemo, useState } from 'react';
import { readFrontmatter, writeFrontmatter } from '@plinto/core/frontmatter';
import type { CollectionConfig } from '@plinto/core';
import { usePlinto } from '../../context';

/**
 * The state and save flow both collection editors share: frontmatter for the
 * declared fields, the dirty/saving/minor-fix lifecycle, and the choice
 * between a plain save and a Save & Sync (which hands the built MDX to
 * SaveFlow — the modal owns that save). The editors keep only what
 * differs: how the body is edited, and how it turns back into markdown
 * (`buildBody`).
 */
export function useCollectionEntry(opts: {
  config: CollectionConfig;
  contentPath: string;
  lang: string;
  initialMdx: string;
  onSaved: () => void;
  /** The edited body as markdown/MDX, without frontmatter. */
  buildBody: () => string;
}) {
  const { ops } = usePlinto();
  const { editContent, fixContent } = ops;
  const { config, contentPath, lang, onSaved } = opts;
  // The shared reader, not a bare matter(): it turns YAML timestamps into
  // short ISO strings first. A `date` field read raw arrives as a Date, and
  // the String() below would then store "Sun Feb 15 2026 01:00:00 GMT+0100
  // (Central European Standard Time)" as the entry's publish date.
  const parsed = useMemo(() => readFrontmatter(opts.initialMdx), [opts.initialMdx]);

  // Only the keys this editor actually renders become strings for the inputs.
  // Everything else keeps its parsed type: `rev` is a number and `synced` is a
  // map, and blanket String() turned them into '3' and '[object Object]',
  // which parse back as rev 0 with no synced map. The entry then looked older
  // than its translations and the next sync overwrote it.
  const managedKeys = useMemo(() => new Set(config.fields.map(f => f.key)), [config.fields]);
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(() => {
    const fm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      fm[k] = managedKeys.has(k) ? (v == null ? '' : String(v)) : v;
    }
    return fm;
  });

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMinorFix, setIsMinorFix] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSyncMdx, setPendingSyncMdx] = useState<string | null>(null);

  /** Form inputs need a string; unmanaged keys keep their parsed type. */
  const fieldValue = (key: string): string => {
    const v = frontmatter[key];
    return v == null ? '' : typeof v === 'string' ? v : String(v);
  };

  const updateFrontmatter = (key: string, value: string) => {
    setFrontmatter(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  // Through the shared writer, not matter.stringify directly: a bare
  // stringify folds long lines at 80 columns and writes nested maps in block
  // style, so an entry saved here and then stamped by the sync engine had its
  // frontmatter reshuffled every time.
  const buildMdx = () => writeFrontmatter(frontmatter, opts.buildBody());

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const mdx = buildMdx();
      if (isMinorFix) await fixContent(contentPath, lang, mdx);
      else await editContent(contentPath, lang, mdx);
      setDirty(false);
      setIsMinorFix(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // The modal owns the save itself, so it gets the content and we only reset
  // local state once it reports done.
  const handleSaveAndSync = () => {
    // A minor fix means "the content changed, the revision did not", so no
    // other language became stale and there is nothing for the sync to do.
    // The modal only knows how to editContent, so asking it would bump the
    // revision and mark every sibling stale — the opposite of what the
    // checkbox says. It used to do exactly that, and then clear the checkbox
    // as though the flag had been honoured.
    if (isMinorFix) return handleSave();
    setError(null);
    // buildBody() runs the MDX generator, which throws on content it cannot
    // write. handleSave has always had this inside its try; here it was the
    // argument to a setState, so the failure rejected unhandled and Save &
    // Sync did nothing, silently.
    try {
      setPendingSyncMdx(buildMdx());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This entry cannot be saved as it stands.');
    }
  };

  return {
    /** The document body below the frontmatter, as parsed from initialMdx. */
    parsedBody: parsed.body,
    fieldValue,
    updateFrontmatter,
    markDirty: () => setDirty(true),
    error,
    setError,
    /** Spread onto EditorHeader. */
    headerProps: {
      title: fieldValue(config.titleField) || '(untitled)',
      lang,
      dirty,
      saving,
      isMinorFix,
      onMinorFixChange: setIsMinorFix,
      onSave: handleSave,
      onSaveAndSync: handleSaveAndSync,
    },
    /** Spread onto SaveFlow when non-null. */
    syncModalProps: pendingSyncMdx === null ? null : {
      contentPath,
      lang,
      mdxContent: pendingSyncMdx,
      // The commit has landed, so the entry stops being dirty here rather
      // than at close: cancelling the translation that follows does not
      // un-save what is already on disk.
      onSaved: () => {
        setDirty(false);
        setIsMinorFix(false);
        onSaved();
      },
      onDone: () => setPendingSyncMdx(null),
      onCancel: () => setPendingSyncMdx(null),
    },
  };
}

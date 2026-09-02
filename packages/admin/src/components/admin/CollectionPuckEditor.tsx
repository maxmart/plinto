import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Puck, type Data } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { EditorHeader } from './EditorHeader';
import SaveFlow from '../SaveFlow';
import { createConfig } from '../puck/build-config';
import { usePlinto } from '../../context';
import { FieldInput } from './FieldInput';
import { useCollectionEntry } from './useCollectionEntry';
import type { CollectionConfig } from '@plinto/core';

/**
 * puckToMdx always emits a YAML frontmatter block, even when the frontmatter
 * map is empty (output: "---\n---\n\nbody…"). This strips that leading empty
 * block so the entry hook can re-attach its own frontmatter.
 */
function stripEmptyFrontmatter(mdx: string): string {
  return mdx.replace(/^---\s*\n---\s*\n/, '');
}

interface Props {
  config: CollectionConfig;
  contentPath: string;
  lang: string;
  initialMdx: string;
  onSaved: () => void;
}

export function CollectionPuckEditor({ config, contentPath, lang, initialMdx, onSaved }: Props) {
  const plinto = usePlinto();
  const { parse: parseDocument, generate: generateDocument } = plinto.mdx;
  const [puckData, setPuckData] = useState<Data>({ content: [], root: {} });
  const latestData = useRef<Data>({ content: [], root: {} });
  const [loading, setLoading] = useState(true);

  const entry = useCollectionEntry({
    config,
    contentPath,
    lang,
    initialMdx,
    onSaved,
    buildBody: () => stripEmptyFrontmatter(generateDocument(latestData.current, {})),
  });
  const { setError } = entry;

  useEffect(() => {
    try {
      const { data } = parseDocument(entry.parsedBody, { label: contentPath });
      setPuckData(data);
      latestData.current = data;
    } catch (err) {
      // Most likely the entry holds prose this canvas cannot represent.
      // Surfaced rather than thrown away: an unhandled rejection here left
      // the editor on "Loading…" indefinitely.
      setError(err instanceof Error ? err.message : 'Failed to load entry');
    } finally {
      setLoading(false);
    }
  }, [entry.parsedBody, contentPath, setError]);

  // No chrome: a collection entry is a document, not a page with a shell.
  const puckConfig = useMemo(() => createConfig(plinto, { lang }), [plinto, lang]);

  const handleDataChange = useCallback((next: Data) => {
    latestData.current = next;
    entry.markDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  // A load failure has no canvas to show, so it gets the whole pane rather
  // than a banner above an empty editor the user might save over.
  if (entry.error && puckData.content.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm font-medium text-red-700 mb-1">Cannot open this entry</p>
        <p className="text-sm text-gray-600 whitespace-pre-wrap">{entry.error}</p>
        <a href="/plinto/admin/" className="inline-block mt-4 text-sm text-blue-600 underline">Back to admin</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <EditorHeader {...entry.headerProps} />

      {entry.error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-600 rounded text-sm">{entry.error}</div>
      )}

      <div className="px-6 py-4 border-b bg-gray-50 space-y-3">
        {config.fields.map(field => (
          <FieldInput
            key={field.key}
            field={field}
            value={entry.fieldValue(field.key)}
            onChange={v => entry.updateFrontmatter(field.key, v)}
          />
        ))}
      </div>

      <div className="flex-1 min-h-0">
        <Puck
          config={puckConfig}
          data={puckData}
          onChange={handleDataChange}
          iframe={{ enabled: true }}
        />
      </div>

      {entry.syncModalProps && <SaveFlow {...entry.syncModalProps} />}
    </div>
  );
}

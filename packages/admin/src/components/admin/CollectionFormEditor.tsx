import { useState } from 'react';
import { FieldInput } from './FieldInput';
import { RichTextField } from './RichTextField';
import { EditorHeader } from './EditorHeader';
import SaveFlow from '../SaveFlow';
import { useCollectionEntry } from './useCollectionEntry';
import type { CollectionConfig } from '@plinto/core';

interface CollectionFormEditorProps {
  config: CollectionConfig;
  contentPath: string;
  lang: string;
  initialMdx: string;
  onSaved: () => void;
}

export function CollectionFormEditor({
  config,
  contentPath,
  lang,
  initialMdx,
  onSaved,
}: CollectionFormEditorProps) {
  const [body, setBody] = useState<string | null>(null);
  const entry = useCollectionEntry({
    config,
    contentPath,
    lang,
    initialMdx,
    onSaved,
    buildBody: () => body ?? entry.parsedBody,
  });

  const updateBody = (value: string) => {
    setBody(value);
    entry.markDirty();
  };

  return (
    <div className="h-screen flex flex-col">
      <EditorHeader {...entry.headerProps} />

      <div className="flex-1 overflow-auto p-6">
        {entry.error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">
            {entry.error}
          </div>
        )}

        {/* A single column of text inputs reads badly at window width; 3xl is
            roughly where a form stops being a line of text stretched thin. */}
        <div className="space-y-4 max-w-3xl mx-auto">
          {config.fields.map(field => {
            if (field.key === 'body') {
              return (
                <div key="body">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>
                  <RichTextField value={body ?? entry.parsedBody} onChange={updateBody} />
                </div>
              );
            }
            return (
              <FieldInput
                key={field.key}
                field={field}
                value={entry.fieldValue(field.key)}
                onChange={v => entry.updateFrontmatter(field.key, v)}
              />
            );
          })}
        </div>
      </div>

      {entry.syncModalProps && <SaveFlow {...entry.syncModalProps} />}
    </div>
  );
}

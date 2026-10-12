import { useEffect, useState, type ChangeEvent } from 'react';

interface StringListFieldProps {
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  readOnly?: boolean;
  id?: string;
  label?: string;
  paragraphs?: boolean;
}

/** The items a textarea's text stands for: one per line, or per blank-line-separated paragraph. */
export function splitItems(raw: string, paragraphs: boolean): string[] {
  return raw
    .split(paragraphs ? /\n\s*\n/ : /\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function joinItems(items: string[] | undefined, paragraphs: boolean): string {
  return (items ?? []).join(paragraphs ? '\n\n' : '\n');
}

/**
 * A `string[]` prop, edited as text: one item per line, or with `paragraphs`
 * one per paragraph. Puck's array field holds objects, so a list of plain
 * strings had no field at all (asewerner-site, #8).
 *
 * The textarea keeps its own raw text. Splitting on every keystroke would eat
 * the empty line just typed to start the next item, so the text is only
 * replaced when the value changes from outside — undo, another block — to
 * something the text does not already mean.
 */
export function StringListField({ value, onChange, readOnly, id, label, paragraphs = false }: StringListFieldProps) {
  const [raw, setRaw] = useState(() => joinItems(value, paragraphs));

  useEffect(() => {
    if (JSON.stringify(splitItems(raw, paragraphs)) !== JSON.stringify(value ?? [])) {
      setRaw(joinItems(value, paragraphs));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, paragraphs]);

  const handle = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setRaw(e.target.value);
    onChange(splitItems(e.target.value, paragraphs));
  };

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-xs font-medium text-gray-700">{label}</label>
      )}
      <textarea
        id={id}
        value={raw}
        readOnly={readOnly}
        onChange={handle}
        rows={Math.max(3, raw.split('\n').length + 1)}
        className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <p className="text-xs text-gray-500">
        {paragraphs ? 'A blank line between items.' : 'One item per line.'}
      </p>
    </div>
  );
}

// Puck custom field wrapper
export function createStringListField(options: { label?: string; paragraphs?: boolean }) {
  return {
    type: 'custom' as const,
    render: ({ value, onChange, readOnly, id }: {
      value: string[] | undefined; onChange: (value: string[]) => void; readOnly?: boolean; id?: string;
    }) => (
      <StringListField
        value={value} onChange={onChange} readOnly={readOnly} id={id}
        label={options.label} paragraphs={options.paragraphs}
      />
    ),
  };
}

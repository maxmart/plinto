import type { CollectionFieldConfig } from '@plinto/core';
import { ImagePickerField } from '../puck/fields/ImagePickerField';

interface FieldInputProps {
  field: CollectionFieldConfig;
  value: string;
  onChange: (v: string) => void;
}

export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const baseInput =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  let control: React.ReactNode;
  switch (field.type) {
    case 'text':
      control = (
        <input
          type="text"
          className={baseInput}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      );
      break;
    case 'textarea':
      control = (
        <textarea
          className={baseInput}
          rows={3}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      );
      break;
    case 'select':
      control = (
        <select
          className={baseInput}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
      break;
    case 'date':
      control = (
        <input
          type="date"
          className={baseInput}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      );
      break;
    case 'image':
      // The same control the block editor uses — preview, browse, upload,
      // clear. It is a plain controlled input; only createImagePickerField
      // around it is Puck-specific, so the two editors cannot drift apart.
      control = <ImagePickerField value={value} onChange={onChange} folder={field.folder} />;
      break;
    case 'richtext':
      throw new Error(
        `FieldInput cannot render type 'richtext'. Use RichTextField instead.`
      );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {field.label}
      </label>
      {control}
    </div>
  );
}

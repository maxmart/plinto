import { useState } from 'react';
import { PageBrowser } from '../../PageBrowser';

interface PageLinkFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label?: string;
  lang?: string;
}

export function PageLinkField({ value, onChange, readOnly, label, lang }: PageLinkFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isExternal = value?.startsWith('http://') || value?.startsWith('https://');
  const isInternal = value?.startsWith('/');

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-xs font-medium text-gray-700">{label}</label>
      )}
      <input
        type="text"
        value={value ?? ''}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/sv/streaming or https://example.com"
        className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {!readOnly && (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          title="Pick a page"
        >
          Pick page…
        </button>
      )}
      {value && (
        <p className="text-xs text-gray-500 truncate">
          {isExternal ? 'External URL' : isInternal ? 'Internal page' : 'Other'}
        </p>
      )}

      <PageBrowser
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={(href) => onChange(href)}
        currentValue={value}
        lang={lang}
      />
    </div>
  );
}

// Puck custom field wrapper
export function createPageLinkField(options?: { label?: string; lang?: string }) {
  return {
    type: 'custom' as const,
    render: ({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly?: boolean }) => (
      <PageLinkField value={value} onChange={onChange} readOnly={readOnly} label={options?.label} lang={options?.lang} />
    ),
  };
}

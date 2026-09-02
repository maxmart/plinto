import { useState, useEffect } from 'react';
import { MediaBrowser } from '../../MediaBrowser';
import { usePlinto } from '../../../context';

interface ImagePickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  mediaType?: 'image' | 'video' | 'all' | 'svg';
  /** Subfolder of the media library to browse and upload into, e.g. 'icons'. */
  folder?: string;
}

export function ImagePickerField({ value, onChange, readOnly, mediaType = 'image', folder }: ImagePickerFieldProps) {
  const { ops } = usePlinto();
  const { getMediaUrl } = ops;
  const [isOpen, setIsOpen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value);

  // Resolve /media/ paths to blob URLs in browser mode
  useEffect(() => {
    if (value?.startsWith('/media/')) {
      getMediaUrl(value).then(setPreviewUrl);
    } else {
      setPreviewUrl(value);
    }
  }, [value]);

  const handleSelect = (url: string) => {
    onChange(url);
  };

  const handleClear = () => {
    onChange('');
  };

  const isLocalMedia = value?.startsWith('/media/');
  const hasValue = value && value.length > 0;
  const isVideo = value?.match(/\.(mp4|webm|mov|ogv)(\?.*)?$/i);

  return (
    <div className="space-y-3">
      {/* Media preview, capped. This field was written for Puck's sidebar,
          where the column is narrow enough that the preview never needed a size
          of its own; the collection form gives it the whole window and a
          portrait came out over a thousand pixels tall. The cap never binds in
          the sidebar. */}
      {hasValue && (
        <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50 max-w-sm">
          <div className="aspect-video">
            {isVideo ? (
              <video
                src={previewUrl}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Selected image"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
                }}
              />
            )}
          </div>
          {!readOnly && (
            <button
              onClick={handleClear}
              className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              title="Remove image"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!readOnly && (
        <div className="flex gap-2">
          <button
            onClick={() => setIsOpen(true)}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {hasValue ? 'Change Media' : 'Select Media'}
          </button>
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
            title="Enter URL manually"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
        </div>
      )}

      {/* URL input */}
      {showUrlInput && !readOnly && (
        <div className="space-y-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500">
            Enter an external URL or use the media browser for uploaded images
          </p>
        </div>
      )}

      {/* Current value info */}
      {hasValue && (
        <p className="text-xs text-gray-500 truncate">
          {isLocalMedia ? 'From media library' : 'External URL'}: {value}
        </p>
      )}

      {/* Media browser modal */}
      <MediaBrowser
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={handleSelect}
        currentValue={value}
        accept={mediaType}
        folder={folder}
      />
    </div>
  );
}

// Puck custom field wrapper. Custom fields render without Puck's own label
// chrome, so the label is drawn here — without it the field is anonymous in
// the sidebar.
export function createImagePickerField(options?: { mediaType?: 'image' | 'video' | 'all' | 'svg'; folder?: string }) {
  return {
    type: 'custom' as const,
    render: ({ value, onChange, readOnly, field }: { value: string; onChange: (value: string) => void; readOnly?: boolean; field?: { label?: string } }) => (
      <div>
        {field?.label && (
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{field.label}</div>
        )}
        <ImagePickerField value={value} onChange={onChange} readOnly={readOnly} mediaType={options?.mediaType} folder={options?.folder} />
      </div>
    ),
  };
}

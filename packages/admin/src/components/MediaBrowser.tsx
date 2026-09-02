
import { useState, useEffect, useCallback, useRef } from 'react';
import { normaliseUpload } from '../images/downscale';
import type { MediaFile } from '@plinto/core/ops/media';
import { usePlinto } from '../context';

interface MediaBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  currentValue?: string;
  accept?: 'image' | 'video' | 'all' | 'svg';
  /**
   * Subfolder of the media library to browse and upload into, e.g. 'icons'.
   * Scoping both ends is the point: a picker for icons should not offer every
   * photo on the site, and an icon uploaded from it should not land among them.
   */
  folder?: string;
}

export function MediaBrowser({ isOpen, onClose, onSelect, currentValue, accept = 'image', folder = '' }: MediaBrowserProps) {
  const { ops } = usePlinto();
  const { listMedia, writeMedia, deleteMedia } = ops;
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const mediaFiles = await listMedia(folder);
      setFiles(mediaFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load media files');
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    if (isOpen) {
      loadFiles();
      // Pre-select current value if it's a local file (stable /media/ path)
      if (currentValue?.startsWith('/media/')) {
        setSelectedFile(currentValue);
      } else {
        setSelectedFile(null);
      }
    }
  }, [isOpen, loadFiles, currentValue]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(fileList)) {
        // Validate file type
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (accept === 'image' && !isImage) { setError('Only image files are allowed'); continue; }
        if (accept === 'video' && !isVideo) { setError('Only video files are allowed'); continue; }
        if (accept === 'all' && !isImage && !isVideo) { setError('Only image and video files are allowed'); continue; }

        // Generate safe filename
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();

        // Bound the original before it is written. What lands here is committed
        // to Git LFS, whose history is immutable — the build-time ladder can
        // shrink what visitors download but can never take a 6 MB phone photo
        // back out of the repository. Videos, SVGs and images already within
        // budget come back untouched.
        const upload = await normaliseUpload(file, safeName);
        const filePath = folder ? `media/${folder}/${upload.fileName}` : `media/${upload.fileName}`;

        await writeMedia(filePath, upload.data, upload.mimeType);
      }

      // Reload files
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleUpload(e.dataTransfer.files);
  };

  const handleDelete = async (file: MediaFile) => {
    if (!confirm(`Delete ${file.name}?`)) return;

    try {
      await deleteMedia(file.path);
      await loadFiles();
      if (selectedFile === `/${file.path}`) {
        setSelectedFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const handleConfirm = () => {
    if (selectedFile) {
      onSelect(selectedFile);
      onClose();
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const visibleFiles = files.filter(f => {
    // SVG is an image/ type too, so it needs checking before the image branch
    // or an icon picker would show every photo alongside the icons.
    if (accept === 'svg' && !f.name.toLowerCase().endsWith('.svg')) return false;
    if (accept === 'image' && !f.mimeType?.startsWith('image/')) return false;
    if (accept === 'video' && !f.mimeType?.startsWith('video/')) return false;
    if (query && !f.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            {folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : 'Media Library'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filenames are the only handle a media file has, so filtering on them
            is what makes a library of any size usable. Shown once there is
            enough in it to be worth narrowing. */}
        {files.length > 8 && (
          <div className="px-6 pt-4">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Upload area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 mb-6 text-center transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : 'image/*,video/*'}
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Uploading...</span>
              </div>
            ) : (
              <>
                <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-gray-600 mb-2">
                  {accept === 'image' ? 'Drag and drop images here' : accept === 'video' ? 'Drag and drop videos here' : 'Drag and drop images or videos here'}
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Browse Files
                </button>
              </>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {/* File grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-8 h-8 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {accept === 'image' ? 'No images uploaded yet' : accept === 'video' ? 'No videos uploaded yet' : 'No media files uploaded yet'}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {visibleFiles.map((file) => (
                <div
                  key={file.path}
                  className={`relative group rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                    selectedFile === `/${file.path}`
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedFile(`/${file.path}`)}
                >
                  <div className="aspect-square bg-gray-100 flex items-center justify-center">
                    {file.mimeType?.startsWith('video/') ? (
                      <div className="relative w-full h-full">
                        <video
                          src={file.url}
                          className="w-full h-full object-cover"
                          muted
                          preload="metadata"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <svg className="w-10 h-10 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={file.url}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <p className="text-white text-xs truncate">{file.name}</p>
                    <p className="text-white/70 text-xs">{formatSize(file.size)}</p>
                  </div>
                  {selectedFile === `/${file.path}` && (
                    <div className="absolute top-2 left-2 p-1 bg-blue-600 rounded-full">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedFile}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Select Media
          </button>
        </div>
      </div>
    </div>
  );
}

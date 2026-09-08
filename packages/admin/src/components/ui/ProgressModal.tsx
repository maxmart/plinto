import { type ReactNode, type Ref } from 'react';

/**
 * The step-flow modal chrome the sync/publish modals share: overlay, card,
 * title + subtitle header, a thin progress bar, a scrollable body, and a
 * footer. Content and buttons stay with the caller.
 */
export function ProgressModal({
  title,
  subtitle,
  progress,
  tone,
  width = 'w-[600px]',
  bodyRef,
  footer,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 0–100. */
  progress: number;
  tone: 'active' | 'done' | 'error' | 'warn';
  width?: string;
  /** For auto-scrolling the body to follow live output. */
  bodyRef?: Ref<HTMLDivElement>;
  footer: ReactNode;
  children: ReactNode;
}) {
  const barColor =
    tone === 'done' ? 'bg-green-500' :
    tone === 'error' ? 'bg-red-500' :
    tone === 'warn' ? 'bg-amber-500' :
    'bg-blue-500';

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className={`bg-white rounded-lg shadow-xl ${width} max-h-[85vh] overflow-hidden flex flex-col`}>
        <div className="p-4 border-b">
          <h2 className="font-bold text-lg">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>

        <div className="h-1.5 bg-gray-100">
          <div
            className={`h-full transition-all duration-500 ${barColor}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-2" ref={bodyRef}>
          {children}
        </div>

        <div className="p-4 border-t bg-gray-50 flex gap-2">
          {footer}
        </div>
      </div>
    </div>
  );
}

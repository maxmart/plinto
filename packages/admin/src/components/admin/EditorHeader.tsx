import { useRef, useState } from 'react';

interface EditorHeaderProps {
  title: string;
  lang: string;
  dirty: boolean;
  saving: boolean;
  isMinorFix: boolean;
  onMinorFixChange: (value: boolean) => void;
  /** Save and commit only — no translation pass. */
  onSave: () => void;
  /** Save, then translate into whichever languages went stale. */
  onSaveAndSync: () => void;
  backHref?: string;
}

/**
 * Toolbar for the collection editors, matching the one the page editor renders
 * through Puck's header override: back out, see what you are editing and in
 * which language, notice unsaved work, and save with or without a translation
 * pass. The collection editors previously offered a bare Save button and no
 * way back, which made them feel like a different product.
 *
 * Not shared with the page editor's own header: that one lives inside a Puck
 * override and additionally carries undo/redo and Quick Publish, which have no
 * meaning here. Only the shape and wording are kept in step.
 */
export function EditorHeader({
  title,
  lang,
  dirty,
  saving,
  isMinorFix,
  onMinorFixChange,
  onSave,
  onSaveAndSync,
  backHref = '/plinto/admin/',
}: EditorHeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex items-center justify-between px-4 h-[52px] border-b bg-white box-border">
      <div className="flex items-center gap-4 min-w-0">
        <a href={backHref} className="text-sm text-gray-500 hover:text-gray-700 shrink-0">
          &larr; Back
        </a>
        <span className="font-semibold text-[15px] text-gray-900 truncate">
          {title}
          <span className="text-gray-400 font-normal ml-1.5">{lang.toUpperCase()}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {dirty && (
          <span className="bg-amber-100 text-amber-800 border border-amber-300 rounded-full px-2.5 py-0.5 text-xs font-medium">
            Unsaved changes
          </span>
        )}
        <button
          onClick={onSaveAndSync}
          disabled={!dirty || saving}
          className="bg-blue-600 text-white px-3.5 py-1.5 rounded-md text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save & Sync'}
        </button>
        <div>
          <button
            ref={dropdownBtnRef}
            onClick={() => setShowDropdown(v => !v)}
            className="bg-white text-gray-700 px-2 py-1.5 rounded-md border border-gray-300 text-[13px] hover:bg-gray-50"
            title="More save options"
          >
            &#9660;
          </button>
          {showDropdown && (
            <>
              {/* Click-away catcher behind the menu */}
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div
                className="fixed bg-white border rounded-md shadow-lg z-50 min-w-[150px] overflow-hidden"
                style={{
                  top: (dropdownBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                  right: window.innerWidth - (dropdownBtnRef.current?.getBoundingClientRect().right ?? 0),
                }}
              >
                <label className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] text-gray-700 cursor-pointer border-b hover:bg-gray-100">
                  <input
                    type="checkbox"
                    checked={isMinorFix}
                    onChange={e => onMinorFixChange(e.target.checked)}
                    className="m-0"
                  />
                  Minor fix
                </label>
                <button
                  onClick={() => { setShowDropdown(false); onSave(); }}
                  disabled={!dirty || saving}
                  className="block w-full text-left px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isMinorFix ? 'Save (no sync)' : 'Save only'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

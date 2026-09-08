// The reference, not tsconfig, carries the ambient declaration for the paid
// Font Awesome package into every program that compiles this file — other
// packages include plinto-admin sources by import, not by its tsconfig, so a
// declaration merely sitting in src/ never reaches them.
/// <reference path="../../../fontawesome.d.ts" />
import { useState, useEffect, useMemo } from 'react';
import { MediaBrowser } from '../../MediaBrowser';

/**
 * One icon field: search Font Awesome's set, or upload your own.
 *
 * The value is a JSON string holding one of two shapes —
 *   { "d": "M…", "box": "0 0 576 512" }   a Font Awesome path
 *   { "src": "/media/icons/foo.svg" }      your own file
 * — so a block carries a single prop and the two sources cannot disagree.
 * Picking your own replaces the Font Awesome choice, which is the precedence
 * asked for.
 *
 * The path travels with the page rather than the icon's name, so no Font
 * Awesome code reaches a public page: a page carries the few hundred bytes of
 * the icons it actually uses instead of a megabyte of the ones it does not.
 */
export interface IconValue {
  /** Font Awesome's name for the icon, kept so the picker can say which one is
   *  set and open on it rather than on an empty search. */
  name?: string;
  /** The glyph. Font Awesome draws every style as one filled path, Light
   *  included — the thin look is the shape, not a stroke width. */
  d?: string;
  /** The icon's own box, which varies by glyph: "0 0 512 512", "0 0 640 512". */
  box?: string;
  /** Your own uploaded SVG, used instead of a Font Awesome one. */
  src?: string;
}

/**
 * Accepts either shape. The MDX parser turns `iconPick={{…}}` into an object,
 * while a value typed or pasted as text arrives as a string — assuming one and
 * getting the other silently yields no icon at all, which is exactly what
 * happened when this only handled strings.
 */
export function parseIconValue(value?: string | IconValue): IconValue | null {
  if (!value) return null;
  const v = typeof value === 'string' ? safeParse(value) : value;
  return v && (v.d || v.src) ? v : null;
}

function safeParse(s: string): IconValue | null {
  try { return JSON.parse(s); } catch { return null; }
}

type Icon = { name: string; d: string; box: string; terms: string };

/** Loaded once per editor session, and only when the picker is first opened. */
let cache: Icon[] | null = null;

async function loadIcons(): Promise<Icon[]> {
  if (cache) return cache;
  const mod = await import('@fortawesome/pro-light-svg-icons');
  const seen = new Set<string>();
  const out: Icon[] = [];
  for (const def of Object.values(mod as Record<string, any>)) {
    if (!def?.icon || !def.iconName) continue;
    // The package exports aliases too — several keys for one glyph — and a
    // grid showing the same icon four times is worse than one that shows it
    // once.
    if (seen.has(def.iconName)) continue;
    seen.add(def.iconName);
    const [w, h, ligatures, , path] = def.icon;
    const d = Array.isArray(path) ? path[0] : path;
    if (typeof d !== 'string') continue;
    // Font Awesome's ligatures are its synonym list: "map" is also reachable
    // as "map-o", "location". Searching names alone leaves the word you
    // thought of finding nothing.
    const terms = [def.iconName, ...(Array.isArray(ligatures) ? ligatures : [])].join(' ').toLowerCase();
    out.push({ name: def.iconName, d, box: `0 0 ${w} ${h}`, terms });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  cache = out;
  return cache;
}



function Preview({ icon, size = 20 }: { icon: IconValue; size?: number }) {
  if (icon.src) {
    return <img src={icon.src} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />;
  }
  return (
    <svg width={size} height={size} viewBox={icon.box} fill="currentColor" aria-hidden="true">
      <path d={icon.d} />
    </svg>
  );
}

interface IconFieldProps {
  value?: string | IconValue;
  onChange: (value: IconValue | '') => void;
  readOnly?: boolean;
  label?: string;
  /** Media subfolder your own icons are uploaded to. */
  folder?: string;
}

export function IconField({ value, onChange, readOnly, label, folder = 'icons' }: IconFieldProps) {
  const [browsing, setBrowsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const current = parseIconValue(value);

  // Open on what is already set: an empty search cannot tell you which icon
  // the card is using, and finding it again is the common reason to open this.
  useEffect(() => {
    if (browsing) setQuery(current?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing]);

  useEffect(() => {
    if (!browsing || icons.length) return;
    setLoading(true);
    loadIcons().then(list => { setIcons(list); setLoading(false); });
  }, [browsing, icons.length]);

  // 2002 icons is more than a grid can usefully show at once, so the list stays
  // empty until you type. Capped at 120 results: past that the grid is a wall,
  // and a narrower search is the better answer than more scrolling.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Name matches first: searching "user" should not bury `user` under every
    // icon merely tagged with it.
    const byName = icons.filter(i => i.name.includes(q));
    const byTerm = icons.filter(i => !i.name.includes(q) && i.terms.includes(q));
    return [...byName, ...byTerm].slice(0, 120);
  }, [icons, query]);

  const pick = (i: Icon) => {
    onChange({ name: i.name, d: i.d, box: i.box });
    setBrowsing(false);
  };

  return (
    <div className="space-y-2">
      {label && <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{label}</div>}

      {/* No preview or clear out here: the modal header already shows what is
          set, and a second place to change it is a second place to disagree. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setBrowsing(true)}
          className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {current ? 'Change icon' : 'Choose icon'}
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setUploading(true)}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          Your own
        </button>
        {/* Removing is not changing. Keeping the icon's identity in one place
            was right, but it left clearing the field reachable only through the
            dialog you open to pick a different one — so a card that should have
            no icon looked like a card that could not. */}
        {current && !readOnly && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-2 py-2 text-sm text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
          >
            Remove
          </button>
        )}
      </div>

      {browsing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={e => e.target === e.currentTarget && setBrowsing(false)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Icons
                {current && (
                  <span className="flex items-center gap-1 text-sm font-normal text-gray-500">
                    · nu: <Preview icon={current} size={16} />
                    {current.name && <code className="text-xs">{current.name}</code>}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {current && (
                  <button
                    type="button"
                    onClick={() => { onChange(''); setBrowsing(false); }}
                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
                  >
                    Remove icon
                  </button>
                )}
                <button onClick={() => setBrowsing(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-6 pt-4">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={loading ? 'Loading icons…' : `Search ${icons.length} icons — try "calendar", "user", "chart"`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex-1 overflow-auto p-6">
              {!query.trim() && !loading && (
                <p className="text-sm text-gray-500">Type to search.</p>
              )}
              {query.trim() && matches.length === 0 && !loading && (
                <p className="text-sm text-gray-500">No icon matches “{query}”.</p>
              )}
              <div className="grid grid-cols-6 gap-3">
                {matches.map(i => (
                  <button
                    key={i.name}
                    type="button"
                    onClick={() => pick(i)}
                    title={i.name}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border hover:border-blue-500 hover:bg-blue-50 ${
                      current?.name === i.name ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <svg width="22" height="22" viewBox={i.box} fill="currentColor" className="text-gray-700">
                      <path d={i.d} />
                    </svg>
                    <span className="text-[10px] text-gray-500 truncate w-full text-center">{i.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <MediaBrowser
        isOpen={uploading}
        onClose={() => setUploading(false)}
        onSelect={url => { onChange({ src: url }); setUploading(false); }}
        accept="svg"
        folder={folder}
        currentValue={current?.src}
      />
    </div>
  );
}

export function createIconField(options?: { label?: string; folder?: string }) {
  return {
    type: 'custom' as const,
    render: ({ value, onChange, readOnly }: { value: string | IconValue; onChange: (v: any) => void; readOnly?: boolean }) => (
      <IconField value={value} onChange={onChange} readOnly={readOnly} label={options?.label} folder={options?.folder} />
    ),
  };
}

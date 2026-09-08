/**
 * The documents behind one tab of the admin, and their translation status.
 *
 * One cache keyed by view, so switching tabs is instant and switching
 * language is not: a nav switch back to a loaded view keeps what it had,
 * while a language change reloads every visible item in the new language.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { viewKey, type NavView, type ContentItem } from './types';
import { listPages, getCollection } from '../../listing';
import { usePlinto } from '../../context';
import type { AdminRuntime } from '../../runtime';

export interface ContentListState {
  items: ContentItem[];
  loading: boolean;
  loaded: boolean;
  /**
   * Message from a failed load. Shown instead of the empty state, which would
   * otherwise report a storage error as "there is no content here".
   */
  error?: string;
}

const EMPTY: ContentListState = { items: [], loading: false, loaded: false };

/** Everything one view lists, in one language. */
async function readView(view: NavView, lang: string, plinto: AdminRuntime): Promise<ContentItem[]> {
  const { sections, sectionForSlug, pageContentPath, config } = plinto;
  if (view.kind === 'pages') {
    // Section folders have their own tabs; their pages leave this one.
    const files = await listPages(plinto, lang);
    return files
      .filter(f => !sectionForSlug(f.name))
      .map(f => ({
        slug: f.name,
        title: f.title,
        contentPath: pageContentPath(f.name === 'home' ? '' : f.name),
        filePath: f.path,
      }));
  }

  if (view.kind === 'section') {
    const section = sections().find(s => s.folder === view.folder);
    const files = (await listPages(plinto, lang)).filter(f => f.name.startsWith(view.folder));
    const items = files.map(f => {
      // A frontmatter date can arrive as a JS Date (unquoted YAML) or a
      // string (the editor quotes them on save) — display both as ISO.
      const raw = section?.orderKey ? f.data[section.orderKey] : undefined;
      const orderValue = raw === undefined || raw === null
        ? undefined
        : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
      return {
        slug: f.name,
        title: f.title,
        contentPath: `page/${f.name}`,
        filePath: f.path,
        orderValue,
      };
    });
    if (section?.orderKey) {
      const dir = section.orderDesc ? -1 : 1;
      items.sort((a, b) => dir * (a.orderValue ?? '').localeCompare(b.orderValue ?? ''));
    }
    return items;
  }

  if (view.kind === 'partials') {
    return config.partials.map(p => ({ slug: p.name, title: p.label, contentPath: p.name }));
  }

  if (view.kind === 'collection') {
    const entries = await getCollection(plinto, view.name, lang);
    return entries.map(e => ({
      slug: e.slug,
      title: typeof e.data['title'] === 'string' ? e.data['title'] : undefined,
      contentPath: `${view.name}/${e.slug}`,
    }));
  }

  return [];
}

/**
 * @param ready whether storage can be read at all. In browser mode the content
 *   lives in a repo still being cloned on first login; listing it before the
 *   checkout lands throws, and the failure used to be cached as an empty view —
 *   the admin sat on "No content found" until something forced a reload. Dev
 *   mode reads through API routes and has nothing to wait for.
 */
export function useContentList(view: NavView, lang: string, ready: boolean): {
  state: ContentListState;
  reload: () => void;
} {
  const plinto = usePlinto();
  const { config, ops } = plinto;
  const { getStaleness } = ops;
  const [states, setStates] = useState<Record<string, ContentListState>>({});

  const load = useCallback(async (view: NavView, lang: string, keepStaleness: boolean) => {
    if (view.kind === 'settings') return;
    const key = viewKey(view);

    setStates(prev => ({
      ...prev,
      [key]: { items: prev[key]?.items ?? [], loading: true, loaded: false },
    }));

    let items: ContentItem[] = [];
    let failed = false;
    let failure: string | undefined;
    try {
      items = await readView(view, lang, plinto);
    } catch (err) {
      // A read can fail simply because the clone hasn't landed. Recorded so it
      // is not cached as a successful empty result, and the message is kept:
      // reporting a storage failure as "No content found" sends you looking
      // for missing files instead of the actual error.
      //
      // `failed` is separate from `failure` on purpose. Deriving one from the
      // other reads an empty message as no failure at all, which caches the
      // empty list as a success and never retries — the exact outcome the
      // paragraph above exists to prevent.
      failed = true;
      failure = err instanceof Error ? err.message : String(err);
    }

    setStates(prev => {
      const previous = prev[key]?.items ?? [];
      // A language switch reloads the list but not the translation status,
      // which is the same fact in every language — so it is carried over and
      // the badges do not blink out on every switch.
      const merged = keepStaleness
        ? items.map(item => {
            const was = previous.find(e => e.contentPath === item.contentPath);
            return was?.staleness ? { ...item, staleness: was.staleness } : item;
          })
        : items;
      // loaded:false on failure, so the trigger effect retries rather than
      // treating "we never managed to read it" as "there is nothing here".
      return { ...prev, [key]: { items: merged, loading: false, loaded: !failed, error: failure } };
    });

    // Staleness is one round trip per document, so it fills in behind the
    // list rather than holding it up. A failure here leaves the item without
    // badges, which is the honest rendering of "we don't know".
    for (const item of items) {
      getStaleness(item.contentPath)
        .then(info => {
          const staleness: Record<string, 'synced' | 'stale' | 'missing'> = {};
          for (const locale of config.i18n.locales) staleness[locale] = info[locale]?.status ?? 'missing';
          setStates(prev => {
            const state = prev[key];
            if (!state) return prev;
            return {
              ...prev,
              [key]: {
                ...state,
                items: state.items.map(i =>
                  i.contentPath === item.contentPath ? { ...i, staleness } : i),
              },
            };
          });
        })
        .catch(() => {});
    }
  }, []);

  // Mirrors `states` so the trigger below can read the latest value without
  // depending on it — which would re-trigger itself forever.
  const latest = useRef(states);
  useEffect(() => { latest.current = states; }, [states]);

  const previousLang = useRef(lang);

  useEffect(() => {
    if (view.kind === 'settings' || !ready) return;

    const alreadyLoaded = latest.current[viewKey(view)]?.loaded ?? false;
    const langChanged = previousLang.current !== lang;
    previousLang.current = lang;

    // A nav switch back to a view we already have needs nothing.
    if (alreadyLoaded && !langChanged) return;

    load(view, lang, alreadyLoaded && langChanged);
  }, [view, lang, ready, load]);

  return {
    state: view.kind === 'settings' ? EMPTY : states[viewKey(view)] ?? EMPTY,
    reload: useCallback(() => { load(view, lang, false); }, [load, view, lang]),
  };
}

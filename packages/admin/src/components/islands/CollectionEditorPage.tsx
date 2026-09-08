import { useState, useEffect } from 'react';
import { getCollectionConfig, CollectionConfigError } from '../admin/collection-config';
import { CollectionFormEditor } from '../admin/CollectionFormEditor';
import { CollectionPuckEditor } from '../admin/CollectionPuckEditor';
import type { CollectionConfig } from '@plinto/core';
import { usePlinto } from '../../context';

interface ViewState {
  kind: 'loading';
}
interface ErrorState {
  kind: 'error';
  title: string;
  detail: string;
}
interface ReadyState {
  kind: 'ready';
  config: CollectionConfig;
  contentPath: string;
  lang: string;
  mdx: string;
}
type State = ViewState | ErrorState | ReadyState;

export default function CollectionEditorPage() {
  const plinto = usePlinto();
  const { collectionDir } = usePlinto();
  const { ops } = usePlinto();
  const { getContent } = ops;
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const collection = params.get('collection');
      const entry = params.get('entry');
      const lang = params.get('lang') ?? plinto.config.i18n.defaultLocale;

      if (!collection || !entry) {
        setState({ kind: 'error', title: 'Missing parameters', detail: 'Both collection and entry query params are required.' });
        return;
      }

      let config: CollectionConfig;
      try {
        config = getCollectionConfig(plinto.config, collection);
      } catch (err) {
        const detail = err instanceof CollectionConfigError ? err.message : String(err);
        setState({ kind: 'error', title: 'Collection config error', detail });
        return;
      }

      const filePath = `${collectionDir(collection)}/${lang}/${entry}.mdx`;
      let mdx: string;
      try {
        mdx = await getContent(filePath);
      } catch (err) {
        setState({
          kind: 'error',
          title: 'Entry not found',
          detail: `Could not load ${filePath}. ${err instanceof Error ? err.message : ''}`,
        });
        return;
      }

      const contentPath = `${collection}/${entry}`;
      setState({ kind: 'ready', config, contentPath, lang, mdx });
    })();
  }, []);

  if (state.kind === 'loading') {
    return <div className="h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }

  if (state.kind === 'error') {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-red-600 mb-2">{state.title}</h1>
          <p className="text-sm text-gray-700 mb-4">{state.detail}</p>
          <a href="/plinto/admin/" className="text-blue-600 underline">Back to admin</a>
        </div>
      </div>
    );
  }

  // No-op: child editors keep their own local state post-save. We deliberately
  // do NOT reload the page — a hard reload races with lightning-fs's async
  // IndexedDB flush, which can lose the just-committed git objects.
  const onSaved = () => {};

  return state.config.editor === 'form' ? (
    <CollectionFormEditor
      config={state.config}
      contentPath={state.contentPath}
      lang={state.lang}
      initialMdx={state.mdx}
      onSaved={onSaved}
    />
  ) : (
    <CollectionPuckEditor
      config={state.config}
      contentPath={state.contentPath}
      lang={state.lang}
      initialMdx={state.mdx}
      onSaved={onSaved}
    />
  );
}

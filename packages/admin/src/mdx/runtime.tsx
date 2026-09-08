/**
 * Render an MDX document in the browser.
 *
 * The preview shows work that exists only in lightning-fs, so it cannot ask
 * Astro to build the page — but it can compile the same source with the same
 * MDX toolchain and render the result. That keeps one renderer for both: what
 * the preview draws is the document's own markup, not a re-interpretation of
 * it through the editor's data model.
 *
 * Two deliberate differences from the build:
 *
 *  - Import statements are dropped. `evaluate` compiles to a function body,
 *    which cannot carry static imports, so the blocks are supplied by name
 *    from the registry instead — the same set the imports would have resolved
 *    to, minus the .astro variants, which only a build can render.
 *  - Frontmatter is parsed and discarded rather than exported, because the
 *    preview supplies the shell itself.
 *
 * Everything else matches the build: GFM on, smartypants off.
 */
import { evaluate } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import * as runtime from 'react/jsx-runtime';
import { useEffect, useState, type ComponentType } from 'react';

/** Drop the ESM import statements; `components` binds the same names instead. */
function dropImports() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    tree.children = tree.children.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => !(node.type === 'mdxjsEsm' && /^\s*import\b/.test(node.value ?? '')),
    );
  };
}

/** Compile one MDX document into a renderable component. */
async function compileMdx(source: string): Promise<ComponentType<Record<string, unknown>>> {
  const compiled = await evaluate(source, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(runtime as any),
    remarkPlugins: [remarkFrontmatter, remarkGfm, dropImports],
  });
  return compiled.default as ComponentType<Record<string, unknown>>;
}

export interface MdxDocument {
  Content: ComponentType<Record<string, unknown>> | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Compile MDX source for rendering, recompiling when the source changes.
 *
 * A compile failure is returned, never swallowed: malformed MDX is exactly
 * what a preview exists to show you, and reporting it as an empty page would
 * hide the one thing worth seeing.
 */
export function useMdx(source: string | null): MdxDocument {
  const [state, setState] = useState<MdxDocument>({ Content: null, error: null, loading: true });

  useEffect(() => {
    if (source === null) {
      setState({ Content: null, error: null, loading: true });
      return;
    }
    let cancelled = false;
    compileMdx(source).then(
      Content => { if (!cancelled) setState({ Content, error: null, loading: false }); },
      error => { if (!cancelled) setState({ Content: null, error, loading: false }); },
    );
    return () => { cancelled = true; };
  }, [source]);

  return state;
}

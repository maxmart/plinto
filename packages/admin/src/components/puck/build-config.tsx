/**
 * Build a Puck Config from a BlockRegistry (supplied via the plinto Astro
 * integration's virtual:plinto-config module).
 *
 * A registry entry is the component, with its editor config attached as
 * `Component.config`. This factory wraps that config with editor-specific
 * enhancements:
 *   - 'richtext' field sentinels are transformed into Puck's native
 *     richtext field type (with markdown-friendly options)
 *   - 'media-picker' field sentinels are transformed into the library's
 *     ImagePickerField (which integrates with the media browser)
 *   - Components whose render uses /media/ paths are wrapped to resolve
 *     those paths to blob URLs in the editor preview (so images load
 *     from lightning-fs in the browser)
 *
 * Rendering outside the editor uses the raw block components without these
 * enhancements: Astro imports each one straight from the page's MDX.
 */

import type { Config, ComponentConfig } from '@puckeditor/core';
import { ComponentType, ReactNode } from 'react';
import { createImagePickerField } from './fields/ImagePickerField';
import { mediaImage, RichtextImageMenu } from './fields/RichtextImage';
import { createPageLinkField } from './fields/PageLinkField';
import { createIconField } from './fields/IconField';
import { wrapWithMediaUrl, getMediaPaths, type MediaResolver } from '../../blocks/components';
import type { BlockRegistry } from '../../blocks/registry';
import { fieldPaths } from '../../blocks/fields';
import { PreviewShell } from '../../preview';
import type { AdminRuntime } from '../../runtime';

/**
 * Puck native richtext field config for markdown content. Puck's richtext
 * uses Tiptap internally and stores HTML; the MDX parser/generator handles
 * markdown<->HTML conversion at the boundary.
 */
function makeRichtextField(getMediaUrl: MediaResolver, label: string, contentEditable = false) {
  return {
    type: 'richtext' as const,
    label,
    contentEditable,
    options: {
      // Disable features not well-supported in markdown roundtrip
      underline: false as const,
      textAlign: false as const,
      codeBlock: false as const,
      horizontalRule: false as const,
    },
    // Inline images: without the Image extension Tiptap's schema silently
    // DROPS <img> nodes — a save after opening an article would delete its
    // pictures. See fields/RichtextImage for the node view and menu button.
    tiptap: { extensions: [mediaImage(getMediaUrl)] },
    renderMenu: ({ children, editor }: { children: ReactNode; editor: unknown }) => (
      <RichtextImageMenu editor={editor as never}>{children}</RichtextImageMenu>
    ),
  };
}

/**
 * Sentinel field types that user blocks can declare. The factory transforms
 * these into the real Puck field types at registration time.
 */
type RichtextSentinel = { type: 'richtext'; label?: string; contentEditable?: boolean };
type MediaPickerSentinel = { type: 'media-picker'; label?: string; mediaType?: 'image' | 'video' | 'all' | 'svg'; folder?: string };
type PageLinkSentinel = { type: 'page-link'; label?: string };
type IconPickerSentinel = { type: 'icon-picker'; label?: string; folder?: string };

interface TransformContext {
  /** Current editing locale — used by fields that need to scope to a language. */
  lang?: string;
  /** Resolves a /media/ path for the inline-image node view. */
  getMediaUrl: MediaResolver;
}

function transformField(field: unknown, ctx: TransformContext): unknown {
  if (!field || typeof field !== 'object') return field;
  const f = field as Record<string, unknown>;
  if (f.type === 'richtext') {
    const r = f as RichtextSentinel;
    return makeRichtextField(ctx.getMediaUrl, r.label ?? '', r.contentEditable ?? false);
  }
  if (f.type === 'media-picker') {
    const m = f as MediaPickerSentinel;
    return {
      ...createImagePickerField({ mediaType: m.mediaType ?? 'image', folder: m.folder }),
      label: m.label ?? 'Media',
    };
  }
  if (f.type === 'icon-picker') {
    const i = f as IconPickerSentinel;
    return createIconField({ label: i.label ?? 'Icon', folder: i.folder });
  }
  if (f.type === 'page-link') {
    const p = f as PageLinkSentinel;
    return createPageLinkField({ label: p.label ?? 'Link', lang: ctx.lang });
  }

  // Recurse into Puck's composite field types, so a sentinel nested inside a
  // repeatable row or an object group is transformed too. Without this a
  // block like CmLogoGrid — whose images live in logos[].src — could never
  // declare a media picker for them.
  if (f.type === 'array' && f.arrayFields && typeof f.arrayFields === 'object') {
    return { ...f, arrayFields: transformFields(f.arrayFields as Record<string, unknown>, ctx) };
  }
  if (f.type === 'object' && f.objectFields && typeof f.objectFields === 'object') {
    return { ...f, objectFields: transformFields(f.objectFields as Record<string, unknown>, ctx) };
  }

  return field;
}

function transformFields(fields: Record<string, unknown>, ctx: TransformContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    // Never show the id in the editor. Puck owns props.id — it generates
    // "<Type>-<uuid>" on insert and duplicate — and hand-editing it can
    // corrupt the instance identity the editor tracks. The id still travels
    // through props and serializes to MDX; it just isn't a form field.
    if (key === 'id') continue;
    out[key] = transformField(value, ctx);
  }
  return out;
}

/**
 * The site-declared extra page fields that apply to one page, honouring each
 * field's optional `pages` scope — a prefix on the page's path below the
 * locale directory ('jobs/' → src/pages/{lang}/jobs/*). No pageFile (the
 * generic config, partials) offers only the unscoped fields.
 */
/**
 * The datetime field for a date-typed page field. Frontmatter holds
 * "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; the input needs the latter. A midnight
 * time is written back date-only, so pages that never had a time of day
 * don't suddenly grow one.
 */
function makeDateField(label: string) {
  return {
    type: 'custom' as const,
    label,
    render: ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => {
      const inputValue = !value ? '' : value.includes('T') ? value.slice(0, 16) : `${value}T00:00`;
      return (
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{label}</div>
          <input
            type="datetime-local"
            value={inputValue}
            onChange={e => {
              const v = e.target.value;
              onChange(v.endsWith('T00:00') ? v.slice(0, 10) : v);
            }}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14 }}
          />
        </label>
      );
    },
  };
}

function scopedPageFields(plinto: AdminRuntime, pageFile?: string) {
  const { pageFieldsFor, pageRelPath } = plinto;
  return Object.fromEntries(
    Object.entries(pageFieldsFor(pageRelPath(pageFile)))
      .map(([key, f]) => [
        key,
        f.type === 'date' ? makeDateField(f.label) : { type: f.type, label: f.label },
      ]),
  );
}

/**
 * Root-level page metadata fields (title, description), plus whatever extra
 * frontmatter keys the site declares in content.pageFields. The publish date
 * is not built in: a site that wants one declares a 'date'-typed page field,
 * scoped to the pages where a date means something.
 */
const makeRootFields = (plinto: AdminRuntime, pageFile?: string) => ({
  ...scopedPageFields(plinto, pageFile),
  title: {
    type: 'text' as const,
    label: 'Page Title',
  },
  description: {
    type: 'textarea' as const,
    label: 'Page Description',
  },
});

/**
 * Build the components map for the editor. Reads the block registry from
 * virtual:plinto-config, transforms field sentinels, and wraps components
 * that need media-url resolution.
 */
function buildComponents(blocks: BlockRegistry, getMediaUrl: MediaResolver, ctx: TransformContext): Record<string, ComponentConfig<any>> {
  const result: Record<string, ComponentConfig<any>> = {};

  for (const [name, component] of Object.entries(blocks)) {
    const blockConfig = component.config;
    // The storage boundary converts a block's own props and its child
    // blocks, not the insides of an array or object field — so a richtext
    // field nested in one would get an editor and then save raw HTML into
    // the MDX. Refused at registration, using the same walk
    // mdx/richtext-fields uses to decide what to convert, so the two cannot
    // disagree about what "nested" means.
    const nestedRichtext = fieldPaths(blockConfig.fields, 'richtext').filter(p => p.length > 1);
    if (nestedRichtext.length > 0) {
      throw new Error(
        `[plinto] ${name}: richtext is not supported inside an array or object field ` +
        `(${nestedRichtext.map(p => p.join('.')).join(', ')}) — the markdown conversion ` +
        `only reaches a block's own props.`,
      );
    }
    const transformedFields = transformFields(blockConfig.fields, ctx);

    // Wrap render for any media-picker field the block declares — nested in
    // array/object fields included — so /media/ paths resolve to blob URLs
    // in the editor preview.
    const mediaPaths = getMediaPaths(blockConfig.fields);
    let render: ComponentType<any> | undefined;
    if (mediaPaths.length > 0) {
      // Wrap whatever the block actually renders with — its own `render` when it
      // has one, the bare component otherwise. Wrapping the component instead
      // used to discard that `render`, and for a block declaring both a
      // media-picker field and a slot that silently broke the slot: the config's
      // render is what turns Puck's slot prop into `<Children />`, so without it
      // the component received a raw array of block objects, mounted nothing,
      // and no DropZone was created — an empty band that could not be filled and
      // existing children that did not show. wrapWithMediaUrl spreads every
      // other prop through untouched, so the slot survives the wrapping.
      render = wrapWithMediaUrl(blockConfig.render ?? component, mediaPaths, getMediaUrl);
    } else if (blockConfig.render) {
      render = blockConfig.render;
    } else {
      render = component;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result[name] = {
      fields: transformedFields,
      defaultProps: blockConfig.defaultProps,
      // Passed through, not interpreted: a block that fills props from a live
      // source (CmNations fetches its country list) needs it to run on the
      // canvas too, or the editor shows an empty version of the block.
      ...(blockConfig.resolveData ? { resolveData: blockConfig.resolveData } : {}),
      render,
    } as ComponentConfig<any>;
  }

  return result;
}

export interface CreateConfigOptions {
  /**
   * Site-relative path of the document being edited, when that document is a
   * partial. The site's preview shell renders the canvas in that partial's own
   * place, so a top bar is edited inside the real header with the real footer
   * below it.
   */
  editingFile?: string;
  /** Editing locale — the shell and the fields that resolve per-language need it. */
  lang?: string;
  /**
   * Site-relative path of the document when it is a page (not a partial), so
   * the shell can arrange by where the page lives — see ShellContext.pageFile.
   */
  pageFile?: string;
}

/**
 * Create a Puck Config for the document being edited.
 *
 * The canvas is always rendered inside the site's preview shell, so a page is
 * edited between its real top bar and footer, and a partial is edited in its
 * own place within that same shell. A site with no previewPath gets the canvas
 * on its own — the library no longer has an opinion about what a shell is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createConfig(plinto: AdminRuntime, options: CreateConfigOptions = {}): Config {
  const { blocks, ops, previewShell } = plinto;
  const { editingFile, lang = '', pageFile } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    components: buildComponents(blocks, ops.getMediaUrl, { lang, getMediaUrl: ops.getMediaUrl }),
    root: {
      fields: makeRootFields(plinto, pageFile),
      // Puck hands the root render its own props, which are the document's
      // metadata fields — forwarded so the shell tracks edits live.
      render: ({ children, title, description, date }: {
        children: ReactNode; title?: string; description?: string; date?: string;
      }) => (
        <PreviewShell
          lang={lang}
          interactive
          editingFile={editingFile}
          canvas={editingFile ? children : undefined}
          pageFile={pageFile}
          frontmatter={{ title, description, date }}
        >
          {editingFile ? null : children}
        </PreviewShell>
      ),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Inline images for the Puck richtext field.
 *
 * Two halves:
 *
 * - MediaImage: Tiptap's Image extension with a custom node view that
 *   resolves /media/ paths through getMediaUrl. Without the extension, a
 *   Tiptap schema silently DROPS <img> nodes — opening an article with
 *   inline images and saving would delete them. The node view is what makes
 *   the picture visible in the deployed admin, where /media/ files live in
 *   the browser repo, not on the server.
 *
 * - RichtextImageMenu: a renderMenu wrapper adding an "insert image" button
 *   that opens the media browser and inserts the picked file at the cursor.
 *
 * Kept deliberately plain: an image is a block-level src+alt, exactly what
 * the markdown `![](...)` it round-trips to can say. Sizing and float
 * layouts belong in real blocks, not in prose.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Image from '@tiptap/extension-image';
import type { Editor } from '@tiptap/core';
import { RichTextMenu } from '@puckeditor/core';
import { MediaBrowser } from '../../MediaBrowser';
import type { MediaResolver } from '../../../blocks/components';
import { htmlToMarkdown, markdownToHtml } from '../../../mdx/markdown-html';

/**
 * Tiptap's Image node, showing a /media/ path as the bytes behind it.
 *
 * A factory, because a node view is not a React component — it builds DOM
 * directly — so it cannot read the runtime from context. The resolver is
 * handed in where the extension is created, which is inside a component.
 */
export const mediaImage = (getMediaUrl: MediaResolver) => Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.alt = String(node.attrs.alt ?? '');
      img.style.maxWidth = '100%';
      const src = String(node.attrs.src ?? '');
      if (src.startsWith('/media/')) {
        img.src =
          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"/>';
        getMediaUrl(src).then(url => { img.src = url; });
      } else {
        img.src = src;
      }
      return { dom: img };
    };
  },
});

/** The distinct tag names in a fragment, for reporting what the schema ate. */
function tagsIn(html: string): string[] {
  // The closing '>' is required: while typing a tag the source passes through
  // an unterminated one, and a looser pattern reports it as a dropped tag.
  return [...new Set([...html.matchAll(/<([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi)].map(m => m[1].toLowerCase()))];
}

const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/**
 * Source view for the richtext field.
 *
 * Markdown rather than HTML, because markdown is what the document actually
 * is. The field's value is HTML only while Tiptap holds it; the MDX file on
 * disk stores markdown, and the same markdownToHtml / htmlToMarkdown pair used
 * here is the one the save path runs. So what this box shows is what the file
 * will contain, not an intermediate representation of it.
 *
 * Tiptap still parses against its schema and silently discards any node the
 * schema lacks — the mechanism that used to delete inline images on save — and
 * markdown can express things the schema has no node for. The dialog therefore
 * converts the draft, applies it, and compares the tags that went in with the
 * ones that survived, rather than letting the loss pass unremarked.
 */
function MarkdownSource({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [dropped, setDropped] = useState<string[]>([]);
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  // Read once. Re-reading on every render would fight the caret: each keystroke
  // commits, which re-renders the field, which would reset the box under the
  // cursor. The box owns the text while it is open; the document owns it
  // otherwise, and reopening reads the document afresh.
  const initial = useRef(htmlToMarkdown(editor.getHTML()));

  const commit = (markdown: string, report: boolean) => {
    const html = markdownToHtml(markdown);
    const before = tagsIn(html);
    editor.commands.setContent(html, { emitUpdate: true });
    if (!report) return;
    const after = tagsIn(editor.getHTML());
    setDropped(before.filter(t => !after.includes(t)));
  };

  const flush = (report: boolean) => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const md = pending.current;
    pending.current = null;
    if (md !== null) commit(md, report);
  };

  // Whatever is still queued when the dialog goes away is written out. Without
  // this the last keystrokes inside the debounce window would be the one thing
  // that could still be lost on a stray click.
  useEffect(() => () => flush(false), []);

  const onType = (markdown: string) => {
    pending.current = markdown;
    if (timer.current !== null) window.clearTimeout(timer.current);
    // Short enough to feel immediate, long enough that a construct being typed
    // out character by character is parsed once rather than at every letter.
    timer.current = window.setTimeout(() => flush(true), 250);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Markdown</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Uncontrolled on purpose — see initial. */}
        <textarea
          defaultValue={initial.current}
          onChange={e => onType(e.target.value)}
          spellCheck={false}
          autoFocus
          className="flex-1 min-h-[45vh] m-6 mb-0 p-3 border rounded font-mono text-[13px] leading-relaxed resize-none"
        />

        {dropped.length > 0 && (
          <p className="mx-6 mt-3 text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            The editor has no schema for {dropped.map(t => `<${t}>`).join(', ')}, so {dropped.length > 1 ? 'those are' : 'that is'} not kept in the document.
            The box still shows what you typed; the content behind it does not have {dropped.length > 1 ? 'them' : 'it'}.
          </p>
        )}

        <div className="flex items-center justify-between px-6 py-4">
          <span className="text-[13px] text-gray-500">Edits apply as you type — this is the same content as the editor.</span>
          <button onClick={onClose} className="px-3 py-2 text-sm rounded bg-gray-900 text-white hover:bg-gray-700">Close</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The field's menu bar: Puck's own controls, plus an image button and a source
 * view.
 *
 * The RichTextMenu wrapper is not decoration. Puck resolves the menu as
 * `renderMenu || DefaultMenu`, and DefaultMenu is what renders this flex row —
 * so a renderMenu returning a bare fragment replaces the row rather than filling
 * it, and Puck's three control groups, each a block-level flex box, stack one
 * per line. Rendering RichTextMenu ourselves puts the row back.
 */
export function RichtextImageMenu({ children, editor }: { children: ReactNode; editor: Editor | null }) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  return (
    <RichTextMenu>
      {children}
      {/* Its own group, so Puck's separator rule draws the divider that marks
          these as ours rather than blending them into the alignment controls. */}
      <RichTextMenu.Group>
        <RichTextMenu.Control
          title="Insert image"
          onClick={() => setBrowserOpen(true)}
          icon={
            <svg {...ICON}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          }
        />
        <RichTextMenu.Control
          title="Edit markdown"
          active={sourceOpen}
          onClick={() => setSourceOpen(true)}
          icon={
            <svg {...ICON}>
              <path d="M8 6l-6 6 6 6" />
              <path d="M16 6l6 6-6 6" />
            </svg>
          }
        />
      </RichTextMenu.Group>

      <MediaBrowser
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={url => {
          setBrowserOpen(false);
          editor?.chain().focus().setImage({ src: url }).run();
        }}
        accept="image"
      />
      {sourceOpen && editor && <MarkdownSource editor={editor} onClose={() => setSourceOpen(false)} />}
    </RichTextMenu>
  );
}

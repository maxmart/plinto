import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, MarkdownStorage } from 'tiptap-markdown';
import { useEffect } from 'react';
// Without the Image extension, Tiptap silently drops ![](...) images from
// the body on the first save. Same node view as the Puck richtext field, so
// /media/ paths display in browser mode too.
import { mediaImage } from '../puck/fields/RichtextImage';
import { usePlinto } from '../../context';

interface RichTextFieldProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

export function RichTextField({ value, onChange, placeholder }: RichTextFieldProps) {
  const { ops } = usePlinto();
  const { getMediaUrl } = ops;
  const editor = useEditor({
    extensions: [StarterKit, Markdown, mediaImage(getMediaUrl)],
    content: value,
    onUpdate: ({ editor }) => {
      const storage = editor.storage as unknown as Record<string, MarkdownStorage>;
      const md = storage.markdown.getMarkdown();
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-3',
      },
    },
  });

  // Sync external value changes (e.g. switching between entries) into the editor.
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage as unknown as Record<string, MarkdownStorage>;
    const current = storage.markdown.getMarkdown();
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  return (
    <div className="border border-gray-300 rounded-md bg-white">
      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  );
}

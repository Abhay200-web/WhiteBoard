import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useId } from 'react';

/** A ProseMirror document as stored on the Host (JSON). */
export type RichTextDoc = Record<string, unknown>;

const extensions = [StarterKit.configure({ link: { openOnClick: false } })];

/** True for `null` and for documents with no text, so empty briefs are stored as `null`. */
export function isRichTextEmpty(doc: RichTextDoc | null | undefined): boolean {
  if (!doc) return true;
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === 'string' && n.text.trim() !== '') return true;
    if (n.type && n.type !== 'doc' && n.type !== 'paragraph' && !n.content && n.type !== 'text') {
      return true; // an image, rule, etc.
    }
    return Array.isArray(n.content) && n.content.some(walk);
  };
  return !walk(doc);
}

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'rounded px-2 py-1 text-xs font-medium hover:bg-surface-2 ' +
        (active ? 'bg-surface-2 text-text' : 'text-muted')
      }
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap gap-1 border-b border-line p-1"
    >
      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Heading"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
    </div>
  );
}

const PROSE =
  'min-h-32 px-3 py-2 text-sm outline-none [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold ' +
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_a]:text-accent [&_a]:underline';

/** Rich-text box for briefs and instructions. `onChange` gets the document JSON. */
export function RichTextEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
}) {
  const id = useId();
  const editor = useEditor({
    extensions,
    content: (value as object | null | undefined) ?? undefined,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: PROSE,
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as RichTextDoc),
  });
  return (
    <div className="rounded-md border border-line bg-surface focus-within:outline-2 focus-within:outline-accent">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Read-only rendering of a stored document. */
export function RichTextView({ value }: { value: RichTextDoc }) {
  const editor = useEditor({
    extensions,
    content: value as object,
    editable: false,
    editorProps: { attributes: { class: PROSE.replace('min-h-32 ', '') } },
  });
  return <EditorContent editor={editor} />;
}

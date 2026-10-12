import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { diffWordsWithSpace } from 'diff';
import TranslationLog from './TranslationLog';
import type { TranslationTask } from './translation-queue';
import { sideBySide, foldUnchanged, type Row, type Line } from './side-by-side';

/**
 * What one finished sync did: the target page as it was on the left, as it
 * was saved on the right, and the model's own account of the run. Opened
 * from a row of a task list once the run is over, so the run can be read at
 * leisure instead of only as it scrolls past.
 */
export default function TranslationDetailModal({ task, label, onClose }: {
  task: TranslationTask;
  label: string;
  onClose: () => void;
}) {
  const hasDiff = task.before !== undefined && task.after !== undefined;
  const [tab, setTab] = useState<'changes' | 'log'>(hasDiff ? 'changes' : 'log');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-[95vw] h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-3 border-b flex items-end gap-6">
          <h2 className="font-bold text-lg pb-2">{label}</h2>
          <nav className="flex gap-1 text-sm">
            {hasDiff && <TabButton active={tab === 'changes'} onClick={() => setTab('changes')}>Changes</TabButton>}
            <TabButton active={tab === 'log'} onClick={() => setTab('log')}>Model output</TabButton>
          </nav>
          <button onClick={onClose} className="ml-auto mb-2 px-3 py-1 border rounded hover:bg-gray-100 text-sm">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === 'changes' && hasDiff
            ? <SideBySide before={task.before!} after={task.after!} />
            : (
              <div className="p-4 max-w-4xl">
                {task.log.length > 0
                  ? <TranslationLog log={task.log} />
                  : <p className="text-sm text-gray-400">No output recorded.</p>}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 -mb-px border-b-2 ${active ? 'border-blue-500 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
    >
      {children}
    </button>
  );
}

function SideBySide({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => sideBySide(before, after), [before, after]);
  const [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const shown = useMemo(() => (showAll ? rows : foldUnchanged(rows)), [rows, showAll]);
  const changed = rows.filter(r => r.kind === 'change').length;

  if (changed === 0) {
    return <p className="p-4 text-sm text-gray-500">The saved page is identical to the previous one.</p>;
  }

  return (
    <div>
      <div className="sticky top-0 z-10 grid grid-cols-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
        <div className="px-3 py-1.5 border-r flex items-center">{before === '' ? 'Before (new page)' : 'Before'}</div>
        <div className="px-3 py-1.5 flex items-center">
          After
          <label className="ml-auto flex items-center gap-1 font-normal cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Show whole page
          </label>
        </div>
      </div>
      <table className="w-full table-fixed border-collapse font-mono text-xs leading-5">
        <colgroup>
          <col className="w-10" /><col /><col className="w-10" /><col />
        </colgroup>
        <tbody>
          {shown.map((row, i) =>
            row.kind === 'gap' && !opened.has(i) ? (
              <tr key={i}>
                <td colSpan={4} className="p-0">
                  <button
                    onClick={() => setOpened(s => new Set(s).add(i))}
                    className="w-full py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 text-center"
                  >
                    ⋯ {row.count} unchanged line{row.count !== 1 ? 's' : ''}
                  </button>
                </td>
              </tr>
            ) : row.kind === 'gap' ? (
              row.rows.map((r, j) => <DiffRow key={`${i}.${j}`} row={r} />)
            ) : (
              <DiffRow key={i} row={row} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({ row }: { row: Row }) {
  if (row.kind === 'gap') return null;
  if (row.kind === 'same') {
    return (
      <tr>
        <Num line={row.left} /><Cell text={row.left.text} />
        <Num line={row.right} /><Cell text={row.right.text} />
      </tr>
    );
  }
  const { left, right } = row;
  // A paired line gets word-level marks; a lone line is wholly removed/added.
  const words = left && right ? diffWordsWithSpace(left.text, right.text) : null;
  return (
    <tr>
      <Num line={left} tone="del" />
      <td className={`px-2 whitespace-pre-wrap break-words align-top ${left ? 'bg-red-50' : 'bg-gray-50'}`}>
        {words
          ? words.filter(w => !w.added).map((w, k) => <span key={k} className={w.removed ? 'bg-red-200 rounded-sm' : ''}>{w.value}</span>)
          : left?.text}
      </td>
      <Num line={right} tone="add" />
      <td className={`px-2 whitespace-pre-wrap break-words align-top ${right ? 'bg-green-50' : 'bg-gray-50'}`}>
        {words
          ? words.filter(w => !w.removed).map((w, k) => <span key={k} className={w.added ? 'bg-green-200 rounded-sm' : ''}>{w.value}</span>)
          : right?.text}
      </td>
    </tr>
  );
}

function Num({ line, tone }: { line: Line | null; tone?: 'del' | 'add' }) {
  const bg = !line ? 'bg-gray-50' : tone === 'del' ? 'bg-red-100' : tone === 'add' ? 'bg-green-100' : '';
  return (
    <td className={`px-1 text-right text-gray-400 select-none align-top border-x ${bg}`}>
      {line?.num ?? ''}
    </td>
  );
}

function Cell({ text }: { text: string }) {
  return <td className="px-2 whitespace-pre-wrap break-words align-top text-gray-700">{text}</td>;
}

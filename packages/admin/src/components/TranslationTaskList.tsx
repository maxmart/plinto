import TranslationLog from './TranslationLog';
import type { TranslationTask } from './translation-queue';
import { SpinnerIcon, CheckIcon, CrossIcon, CircleIcon, SkipIcon } from './ui/icons';
import { usePlinto } from '../context';

interface TranslationTaskListProps {
  tasks: TranslationTask[];
  sourceLang: string;
  /** Label formatter — defaults to "Swedish → Norwegian" style */
  formatLabel?: (task: TranslationTask) => string;
}

export default function TranslationTaskList({ tasks, sourceLang, formatLabel }: TranslationTaskListProps) {
  const { langLabel } = usePlinto();
  const defaultLabel = (task: TranslationTask) =>
    `${langLabel(sourceLang)} → ${langLabel(task.targetLang)}`;

  const getLabel = formatLabel ?? defaultLabel;

  return (
    <ul className="space-y-1">
      {tasks.map((task, i) => {
        const isActive = task.status === 'translating' || task.status === 'saving';
        return (
          <li key={`${task.contentPath ?? ''}:${task.targetLang ?? i}`}>
            <div className="flex items-center gap-2 text-sm">
              {/* Status icon */}
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                {task.status === 'pending' && <span className="text-gray-300"><CircleIcon className="w-3.5 h-3.5" /></span>}
                {isActive && <span className="text-blue-500"><SpinnerIcon /></span>}
                {task.status === 'done' && <span className="text-green-500"><CheckIcon className="w-3.5 h-3.5" /></span>}
                {task.status === 'error' && <span className="text-red-500"><CrossIcon className="w-3.5 h-3.5" /></span>}
                {task.status === 'skipped' && <span className="text-gray-400"><SkipIcon className="w-3.5 h-3.5" /></span>}
              </span>

              {/* Label */}
              <span className={
                task.status === 'done' ? 'text-green-700' :
                task.status === 'error' ? 'text-red-600' :
                task.status === 'skipped' ? 'text-gray-400' :
                isActive ? 'text-blue-700 font-medium' :
                'text-gray-500'
              }>
                {getLabel(task)}
                {task.status === 'saving' && ' (saving...)'}
                {task.status === 'skipped' && ' (no changes)'}
              </span>

              {/* Edit count badge */}
              {task.status === 'done' && task.editCount > 0 && (
                <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                  {task.editCount} edit{task.editCount !== 1 ? 's' : ''}
                </span>
              )}

              {/* Inline error */}
              {task.status === 'error' && task.error && (
                <span className="text-xs text-red-400 truncate max-w-[200px]" title={task.error}>
                  {task.error}
                </span>
              )}
            </div>

            {/* Expanded log for active task */}
            {isActive && (
              <div className="mt-2 ml-6">
                <TranslationLog log={task.log} isActive={task.status === 'translating'} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

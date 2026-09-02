import { SpinnerIcon, CheckIcon, CircleIcon, WarningIcon } from './icons';

/** One line of a step-flow modal: status icon plus label. */
export function StepRow({ label, status, suffix }: {
  label: string;
  status: 'pending' | 'active' | 'done' | 'warning';
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
        {status === 'active' && <span className="text-blue-500"><SpinnerIcon /></span>}
        {status === 'done' && <span className="text-green-500"><CheckIcon /></span>}
        {status === 'warning' && <span className="text-amber-500"><WarningIcon /></span>}
        {status === 'pending' && <span className="text-gray-300"><CircleIcon /></span>}
      </span>
      <span className={
        status === 'active' ? 'text-blue-700 font-medium' :
        status === 'done' ? 'text-green-700' :
        status === 'warning' ? 'text-amber-700 font-medium' :
        'text-gray-400'
      }>
        {label}{suffix}
      </span>
    </div>
  );
}

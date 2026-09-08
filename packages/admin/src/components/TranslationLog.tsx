
import ReactMarkdown from 'react-markdown';
import type { LogItem } from '@plinto/core/agents/translate';

interface TranslationLogProps {
  log: LogItem[];
  isActive?: boolean; // show "Starting translation..." when active + empty
}

export default function TranslationLog({ log, isActive }: TranslationLogProps) {
  return (
    <div className="space-y-2">
      {log.map((item, i) => {
        if (item.type === 'thinking') {
          return (
            <div key={i} className="text-sm text-gray-400 italic animate-pulse">
              Thinking...
            </div>
          );
        }
        if (item.type === 'text') {
          return (
            <div key={i} className="text-sm text-gray-700 prose prose-sm max-w-none">
              <ReactMarkdown>{item.content}</ReactMarkdown>
            </div>
          );
        }
        if (item.type === 'edit') {
          return (
            <div key={i} className="border rounded text-xs font-mono overflow-hidden">
              <div className="bg-red-50 text-red-700 p-2 border-b whitespace-pre-wrap">
                <span className="text-red-400 mr-1">-</span>
                {item.old_string.length > 300 ? item.old_string.slice(0, 300) + '...' : item.old_string}
              </div>
              <div className="bg-green-50 text-green-700 p-2 whitespace-pre-wrap">
                <span className="text-green-400 mr-1">+</span>
                {item.new_string.length > 300 ? item.new_string.slice(0, 300) + '...' : item.new_string}
              </div>
            </div>
          );
        }
        if (item.type === 'error') {
          return (
            <div key={i} className="p-2 bg-red-50 text-red-600 rounded text-xs">
              {item.content}
            </div>
          );
        }
        return null;
      })}
      {isActive && log.length === 0 && (
        <div className="text-sm text-gray-400 animate-pulse">Starting translation...</div>
      )}
    </div>
  );
}

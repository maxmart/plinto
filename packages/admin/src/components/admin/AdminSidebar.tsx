import React from 'react';
import { viewKey, type NavView } from './types';
import { usePlinto } from '../../context';

interface AdminSidebarProps {
  activeView: NavView;
  collections: Array<{ name: string; label: string }>;
  onNavigate: (view: NavView) => void;
}

function isActive(view: NavView, active: NavView): boolean {
  return viewKey(view) === viewKey(active);
}

interface NavItemProps {
  label: string;
  view: NavView;
  activeView: NavView;
  onNavigate: (view: NavView) => void;
}

function NavItem({ label, view, activeView, onNavigate }: NavItemProps) {
  const active = isActive(view, activeView);
  return (
    <button
      onClick={() => onNavigate(view)}
      className={[
        'w-full text-left px-3 py-1.5 text-sm rounded-sm transition-colors',
        active
          ? 'text-blue-700 font-medium bg-blue-50 border-l-2 border-blue-600'
          : 'text-gray-700 hover:bg-gray-100 border-l-2 border-transparent',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function AdminSidebar({ activeView, collections, onNavigate }: AdminSidebarProps) {
  const { sections, config } = usePlinto();
  return (
    <aside className="w-52 shrink-0 bg-white border-r border-gray-200 flex flex-col">
      {/* Content section */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        <p className="px-3 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
          Content
        </p>
        <NavItem label="Pages" view={{ kind: 'pages' }} activeView={activeView} onNavigate={onNavigate} />
        {sections().map(s => (
          <NavItem
            key={s.folder}
            label={s.label}
            view={{ kind: 'section', folder: s.folder }}
            activeView={activeView}
            onNavigate={onNavigate}
          />
        ))}
        {config.partials.length > 0 && (
          <NavItem label="Partials" view={{ kind: 'partials' }} activeView={activeView} onNavigate={onNavigate} />
        )}

        {collections.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Collections
            </p>
            {collections.map(({ name, label }) => (
              <NavItem
                key={name}
                label={label}
                view={{ kind: 'collection', name }}
                activeView={activeView}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </div>

      {/* Settings at bottom */}
      <div className="border-t border-gray-200 py-2 px-2">
        <NavItem label="Settings" view={{ kind: 'settings' }} activeView={activeView} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

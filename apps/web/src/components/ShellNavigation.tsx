'use client';

import { Tooltip } from '@noor-note/ui';
import { BookOpenText, CalendarDays, CheckSquare2, Command, Database, MessageSquareText, Network, PanelsTopLeft, Search, Settings2, Sparkles, Tags, Trash2 } from 'lucide-react';
import { BrandMark } from './BrandMark';

export type ShellView = 'notes' | 'periods' | 'tasks' | 'tags' | 'graph' | 'bases' | 'canvas' | 'chat' | 'organize' | 'trash' | 'settings';

interface ShellNavigationProps {
  view: ShellView;
  onNavigate: (view: ShellView) => void;
  onSearch: () => void;
  onCommand: () => void;
}

const primaryItems = [
  { id: 'notes', label: 'Notes', icon: BookOpenText },
  { id: 'periods', label: 'Calendar', icon: CalendarDays },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'bases', label: 'Bases', icon: Database },
  { id: 'canvas', label: 'Canvas', icon: PanelsTopLeft },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare2 },
  { id: 'chat', label: 'Vault chat', icon: MessageSquareText },
  { id: 'organize', label: 'Organize knowledge', icon: Sparkles },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'trash', label: 'Trash', icon: Trash2 },
] as const;

export function ActivityBar({ view, onNavigate, onSearch, onCommand }: ShellNavigationProps) {
  return <aside className="activity-rail" aria-label="Activity bar">
    <Tooltip content="Noor Note home" side="right"><button type="button" className="activity-brand" aria-label="Noor Note home" onClick={() => onNavigate('notes')}><BrandMark size={32} /></button></Tooltip>
    <nav className="activity-links" aria-label="Activities">
      {primaryItems.map(({ id, label, icon: Icon }) => <Tooltip key={id} content={label} side="right"><button type="button" className={view === id ? 'active' : ''} aria-label={label} aria-current={view === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={20} /></button></Tooltip>)}
      <Tooltip content="Search notes" side="right"><button type="button" aria-label="Search notes" onClick={onSearch}><Search size={20} /></button></Tooltip>
      <Tooltip content="Commands" side="right"><button type="button" aria-label="Open command palette" onClick={onCommand}><Command size={20} /></button></Tooltip>
    </nav>
    <Tooltip content="Settings" side="right"><button type="button" className={`activity-settings ${view === 'settings' ? 'active' : ''}`} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Settings2 size={20} /></button></Tooltip>
  </aside>;
}

export function MobileBottomNavigation({ view, onNavigate, onSearch }: Omit<ShellNavigationProps, 'onCommand'>) {
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
    <button type="button" className={view === 'notes' ? 'active' : ''} aria-current={view === 'notes' ? 'page' : undefined} onClick={() => onNavigate('notes')}><BookOpenText size={20} /><span>Notes</span></button>
    <button type="button" className={view === 'periods' ? 'active' : ''} aria-current={view === 'periods' ? 'page' : undefined} onClick={() => onNavigate('periods')}><CalendarDays size={20} /><span>Calendar</span></button>
    <button type="button" onClick={onSearch}><Search size={20} /><span>Search</span></button>
    <button type="button" className={view === 'graph' ? 'active' : ''} aria-current={view === 'graph' ? 'page' : undefined} onClick={() => onNavigate('graph')}><Network size={20} /><span>Graph</span></button>
    <button type="button" className={view === 'bases' ? 'active' : ''} aria-current={view === 'bases' ? 'page' : undefined} onClick={() => onNavigate('bases')}><Database size={20} /><span>Bases</span></button>
    <button type="button" className={view === 'canvas' ? 'active' : ''} aria-current={view === 'canvas' ? 'page' : undefined} onClick={() => onNavigate('canvas')}><PanelsTopLeft size={20} /><span>Canvas</span></button>
    <button type="button" className={view === 'tasks' ? 'active' : ''} aria-current={view === 'tasks' ? 'page' : undefined} onClick={() => onNavigate('tasks')}><CheckSquare2 size={20} /><span>Tasks</span></button>
    <button type="button" className={view === 'chat' ? 'active' : ''} aria-current={view === 'chat' ? 'page' : undefined} onClick={() => onNavigate('chat')}><MessageSquareText size={20} /><span>AI</span></button>
    <button type="button" className={view === 'organize' ? 'active' : ''} aria-current={view === 'organize' ? 'page' : undefined} onClick={() => onNavigate('organize')}><Sparkles size={20} /><span>Organize</span></button>
    <button type="button" className={view === 'tags' ? 'active' : ''} aria-current={view === 'tags' ? 'page' : undefined} onClick={() => onNavigate('tags')}><Tags size={20} /><span>Tags</span></button>
    <button type="button" className={view === 'settings' ? 'active' : ''} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Settings2 size={20} /><span>Settings</span></button>
  </nav>;
}

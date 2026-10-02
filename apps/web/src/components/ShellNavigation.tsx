'use client';

import type { MouseEvent } from 'react';
import { Tooltip } from '@noor-note/ui';
import { Bell, BookOpenText, CalendarDays, CheckSquare2, Command, Database, GraduationCap, History, LayoutDashboard, LifeBuoy, Menu, MessageSquareText, Network, PanelsTopLeft, Search, Settings2, Sparkles, Tags, Trash2 } from 'lucide-react';
import { BrandMark } from './BrandMark';

export type ShellView = 'dashboard' | 'notes' | 'periods' | 'tasks' | 'study' | 'tags' | 'graph' | 'bases' | 'canvas' | 'chat' | 'organize' | 'activity' | 'recovery' | 'trash' | 'settings';

interface ShellNavigationProps {
  view: ShellView;
  onNavigate: (view: ShellView) => void;
  onSearch: () => void;
  onCommand: () => void;
  onNotifications: () => void;
  unreadNotifications: number;
}

const primaryItems = [
  { id: 'dashboard', label: 'Dashboards', icon: LayoutDashboard },
  { id: 'notes', label: 'Notes', icon: BookOpenText },
  { id: 'periods', label: 'Calendar', icon: CalendarDays },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'bases', label: 'Bases', icon: Database },
  { id: 'canvas', label: 'Canvas', icon: PanelsTopLeft },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare2 },
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'chat', label: 'Vault chat', icon: MessageSquareText },
  { id: 'organize', label: 'Organize knowledge', icon: Sparkles },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'trash', label: 'Trash', icon: Trash2 },
  { id: 'recovery', label: 'Recovery Center', icon: LifeBuoy },
] as const;

export function ActivityBar({ view, onNavigate, onSearch, onCommand, onNotifications, unreadNotifications }: ShellNavigationProps) {
  return <aside className="activity-rail" aria-label="Activity bar">
    <Tooltip content="Noor Note home" side="right"><button type="button" className="activity-brand" aria-label="Noor Note home" onClick={() => onNavigate('dashboard')}><BrandMark size={32} /></button></Tooltip>
    <nav className="activity-links" aria-label="Activities">
      {primaryItems.map(({ id, label, icon: Icon }) => <Tooltip key={id} content={label} side="right"><button type="button" className={view === id ? 'active' : ''} aria-label={label} aria-current={view === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={20} /></button></Tooltip>)}
      <Tooltip content="Search notes" side="right"><button type="button" aria-label="Search notes" onClick={onSearch}><Search size={20} /></button></Tooltip>
      <Tooltip content="Commands" side="right"><button type="button" aria-label="Open command palette" onClick={onCommand}><Command size={20} /></button></Tooltip>
    </nav>
    <Tooltip content="Notifications" side="right"><button type="button" className="activity-settings" aria-label={`Notifications, ${unreadNotifications} unread`} onClick={onNotifications}><Bell size={20} />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button></Tooltip>
    <Tooltip content="Settings" side="right"><button type="button" className={`activity-settings ${view === 'settings' ? 'active' : ''}`} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Settings2 size={20} /></button></Tooltip>
  </aside>;
}

export function MobileBottomNavigation({ view, onNavigate, onSearch, onMore }: Omit<ShellNavigationProps, 'onCommand' | 'onNotifications' | 'unreadNotifications'> & { onMore: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
    <button type="button" className={view === 'notes' ? 'active' : ''} aria-current={view === 'notes' ? 'page' : undefined} onClick={() => onNavigate('notes')}><BookOpenText size={20} /><span>Notes</span></button>
    <button type="button" className={view === 'tasks' ? 'active' : ''} aria-current={view === 'tasks' ? 'page' : undefined} onClick={() => onNavigate('tasks')}><CheckSquare2 size={20} /><span>Tasks</span></button>
    <button type="button" className={view === 'periods' ? 'active' : ''} aria-current={view === 'periods' ? 'page' : undefined} onClick={() => onNavigate('periods')}><CalendarDays size={20} /><span>Calendar</span></button>
    <button type="button" aria-label="Search notes" onClick={onSearch}><Search size={20} /><span>Search</span></button>
    <button type="button" aria-label="More navigation" onClick={onMore}><Menu size={20} /><span>More</span></button>
  </nav>;
}

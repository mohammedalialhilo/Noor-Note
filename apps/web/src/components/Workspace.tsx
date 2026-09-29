'use client';

import {
  ArrowLeft, Bold, BookOpenText, Check, CheckSquare2, Mic,
  ChevronDown, Code2, Download, Eye, FileText, Heading2, Italic, Link2,
  List, Menu, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus,
  Search, ShieldCheck, Tags, Trash2, Upload, X, Undo2, Redo2, Pin, Columns2, Rows2, RotateCcw, Copy, Network, Database, PanelsTopLeft, CalendarDays, MessageSquareText, Bookmark as BookmarkIcon, Star, Sparkles,
} from 'lucide-react';
import type { NoteActionEdit, NoteActionId, NoteActionSource } from '@noor-note/ai';
import { buildTagTree, documentStats, extractTags, headingSlug, parseOutline, type Bookmark, type MetadataSchema, type NoteRefactorRequest, type PeriodKind, type PropertyType, type PropertyValue, type VaultNote, type Workspace as SavedWorkspace } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import type { SearchMode, SearchResult, SearchSort } from '@noor-note/search';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react';
import { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { useCloudSync } from '../hooks/useCloudSync';
import { useEditorPreferences } from '../hooks/useEditorPreferences';
import { downloadText, formatNoteDate } from '../lib/workspace';
import { MarkdownEditor, type EditorPreferences, type MarkdownEditorHandle } from './MarkdownEditor';
import { MarkdownReadingView } from './MarkdownReadingView';
import { LinkInspector } from './LinkInspector';
import { PropertyPanel } from './PropertyPanel';
import { TagManager } from './TagManager';
import { QuickSwitcher } from './QuickSwitcher';
import { SearchSnippet, SearchTools } from './SearchTools';
import { addRecentSearch, readSearchHistory, toggleSavedSearch, type SearchHistory } from '../lib/search-history';
import { activateEditorTab, closeEditorPane, closeEditorTab, createEditorPane, findEditorPane, firstEditorPane, openEditorTab, pinEditorTab, removeNoteFromEditorLayout, reorderEditorTab, splitEditorPane, type EditorLayoutNode, type EditorTab } from '../lib/editor-layout';
import { CommandSurface, type CommandItem } from '@noor-note/ui';
import { BrandMark } from './BrandMark';
import { ActivityBar, MobileBottomNavigation, type ShellView } from './ShellNavigation';
import { SettingsView } from './SettingsView';
import { VaultExplorer } from './VaultExplorer';
import { TrashView } from './TrashView';
import { GraphView } from './GraphView';
import { BasesView } from './BasesView';
import { CanvasView } from './CanvasView';
import { TemplatePicker, type TemplateAction } from './TemplatePicker';
import { NoteComposer } from './NoteComposer';
import { AiNoteActions } from './AiNoteActions';
import { VaultChat } from './VaultChat';
import { OrganizationReview } from './OrganizationReview';
import { AudioRecorder } from './AudioRecorder';
import { PdfReader } from './PdfReader';
import { OcrPanel } from './OcrPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { VersionHistory } from './VersionHistory';
import { IntegratedCalendar } from './IntegratedCalendar';
import { TaskDashboard } from './TaskDashboard';
import { WorkspaceManager } from './WorkspaceManager';
import { BookmarkManager } from './BookmarkManager';
import { BookmarksStore, type BookmarkDraft } from '../lib/bookmarks';
import { WorkspacesStore, defaultWorkspaceLayout, parseWorkspaceLayout, readCurrentLayout, readStartupWorkspaceId, reconcileWorkspaceLayout, writeCurrentLayout, writeStartupWorkspaceId, type CalendarLayout, type WorkspaceLayout } from '../lib/workspace-layout';
import { GraphClient } from '../lib/graph-client';
import type { Attachment } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { commandRegistry, type CommandAvailability, type CommandContext, type EditorCommandAction } from '../lib/commands';
import { effectiveShortcut, matchesShortcut, normalizeShortcut, readShortcutOverrides, shortcutConflict, writeShortcutOverrides, type ShortcutOverrides } from '../lib/shortcuts';
import { readRecentNotes, recordRecentNote } from '../lib/quick-switcher';

type View = ShellView;

function EmptyNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-art" aria-hidden="true">
        <div className="empty-art-orbit orbit-one" />
        <div className="empty-art-orbit orbit-two" />
        <div className="empty-art-page page-back" />
        <div className="empty-art-page page-front">
          <span /><span /><span /><span />
        </div>
        <div className="empty-art-sun" />
      </div>
      <span className="eyebrow">YOUR SPACE TO THINK</span>
      <h1>Every idea starts<br />somewhere.</h1>
      <p>Create your first note and give your thoughts a place to grow. Notes start on this device; cloud sync is optional.</p>
      <button className="button-primary" type="button" onClick={onCreate}><Plus size={18} /> Create your first note</button>
      <div className="empty-hint"><ShieldCheck size={16} /> Private by default · Markdown at heart</div>
    </div>
  );
}

interface EditorPaneProps {
  note: VaultNote;
  notes: NoteEntry[];
  attachments: Attachment[];
  repository: VaultRepository | null;
  saveStatus: 'saved' | 'saving' | 'error';
  onPatch: (id: string, patch: Partial<Pick<VaultNote, 'title' | 'markdown'>>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, fragment?: string) => void;
  onBack: () => void;
  onLocalGraph: () => void;
  mobileEditor: boolean;
  preferences: EditorPreferences;
  onPreferences: (next: EditorPreferences) => void;
  onAddAttachment: (folderId: string | null, file: File) => Promise<Attachment | undefined>;
  onCreateMissing: (target: string, folderId: string | null) => void;
  onLinksChanged: () => Promise<void>;
  onUpdateProperty: (id: string, name: string, value: PropertyValue | undefined, type?: PropertyType, options?: string[]) => Promise<VaultNote | undefined>;
  onApplyPropertyDefaults: (id: string, schemas: MetadataSchema[]) => Promise<VaultNote | undefined>;
  navigationTarget?: { noteId: string; line: number; token: number } | null;
  detailsOpen: boolean;
  setDetailsOpen: Dispatch<SetStateAction<boolean>>;
  favorite: boolean; pinnedNote: boolean; bookmarked: boolean;
  onFavorite: () => void; onPinNote: () => void; onBookmark: () => void;
  onOpenComposer: () => void;
  onOpenAi: () => void;
  onOpenRecorder: () => void;
  onOpenHistory: () => void;
  onOpenPdf: (id: string, page: number, annotationId: string | null) => void;
}

interface EditorPaneHandle { run: (action: EditorCommandAction) => void; getSelectedText: () => string; getSelectionRange: () => { from: number; to: number; text: string } | null; insertText: (text: string) => void; replaceRange: (expectedMarkdown: string, edit: NoteActionEdit) => boolean; undoIfCurrent: (expectedMarkdown: string) => boolean }
const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane({ note, notes, attachments, repository, saveStatus, onPatch, onDelete, onSelect, onBack, onLocalGraph, mobileEditor, preferences, onPreferences, onAddAttachment, onCreateMissing, onLinksChanged, onUpdateProperty, onApplyPropertyDefaults, navigationTarget, detailsOpen, setDetailsOpen, favorite, pinnedNote, bookmarked, onFavorite, onPinNote, onBookmark, onOpenComposer, onOpenAi, onOpenRecorder, onOpenHistory, onOpenPdf }, commandRef) {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [mode, setMode] = useState<'source' | 'live' | 'reading'>('source');
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [distractionFree, setDistractionFree] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [blockLinkMessage, setBlockLinkMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentKindRef = useRef<'image' | 'attachment'>('attachment');
  const tags = extractTags(note.markdown);
  const stats = documentStats(note.markdown);
  const outline = parseOutline(note.markdown);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.noteId !== note.id) return;
    const timer = window.setTimeout(() => { setMode('source'); editorRef.current?.goToLine(navigationTarget.line); }, 80);
    return () => window.clearTimeout(timer);
  }, [navigationTarget, note.id]);

  const requestAttachment = (kind: 'image' | 'attachment') => { attachmentKindRef.current = kind; attachmentInputRef.current?.click(); };
  const insertAttachment = async (file: File) => {
    const attachment = await onAddAttachment(note.folderId, file);
    if (!attachment) return;
    const filename = encodeURI(attachment.path.split('/').at(-1) ?? attachment.name);
    editorRef.current?.insertText(attachmentKindRef.current === 'image' ? `![${attachment.name}](${filename})` : `[${attachment.name}](${filename})`);
  };
  const navigateOutline = (line: number, id: string) => {
    setActiveHeading(id);
    if (mode === 'reading') document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else editorRef.current?.goToLine(line);
  };
  const copyBlockLink = async () => {
    const link = editorRef.current?.makeBlockLink(note);
    if (!link) { setBlockLinkMessage('Place the cursor on a nonempty block to copy its link.'); return; }
    try { await navigator.clipboard.writeText(link); setBlockLinkMessage('Block link copied.'); }
    catch { setBlockLinkMessage(`Copy block link: ${link}`); }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const downloadNote = () => {
    downloadText(note.path.split('/').at(-1) ?? 'Untitled.md', note.markdown, 'text/markdown;charset=utf-8');
    setMenuOpen(false);
  };

  const confirmDelete = () => {
    setMenuOpen(false);
    if (window.confirm(`Move “${note.title || 'Untitled note'}” to Trash?`)) onDelete(note.id);
  };

  useImperativeHandle(commandRef, () => ({ getSelectedText: () => editorRef.current?.getSelectedText() ?? '', getSelectionRange: () => editorRef.current?.getSelectionRange() ?? null, insertText: (text) => { setMode('source'); editorRef.current?.insertText(text); }, replaceRange: (expectedMarkdown, edit) => { const changed = editorRef.current?.replaceRange(expectedMarkdown, edit.from, edit.to, edit.insert) ?? false; if (changed) setMode('source'); return changed; }, undoIfCurrent: (expectedMarkdown) => editorRef.current?.undoIfCurrent(expectedMarkdown) ?? false, run: (action) => {
    if (action === 'source' || action === 'live' || action === 'reading') { setMode(action); return; }
    if (action === 'heading') editorRef.current?.insertLinePrefix('## ');
    if (action === 'bold') editorRef.current?.surroundSelection('**', '**');
    if (action === 'italic') editorRef.current?.surroundSelection('*', '*');
    if (action === 'strike') editorRef.current?.surroundSelection('~~');
    if (action === 'task') editorRef.current?.insertLinePrefix('- [ ] ');
    if (action === 'list') editorRef.current?.insertLinePrefix('- ');
    if (action === 'link') editorRef.current?.surroundSelection('[', '](https://)', 'link text');
    if (action === 'inline-code') editorRef.current?.surroundSelection('`', '`', 'code');
    if (action === 'undo') editorRef.current?.undo();
    if (action === 'redo') editorRef.current?.redo();
    if (action === 'find') editorRef.current?.find();
    if (action === 'copy-block-link') void copyBlockLink();
    if (action === 'details') setDetailsOpen((open) => !open);
    if (action === 'settings') setSettingsOpen((open) => !open);
    if (action === 'focus') onPreferences({ ...preferences, focusMode: !preferences.focusMode });
    if (action === 'download') downloadNote();
    if (action === 'delete') confirmDelete();
  } }));

  return (
    <div className={`editor-layout ${detailsOpen && !distractionFree ? '' : 'details-closed'} ${mobileEditor ? 'mobile-editor-visible' : ''} ${distractionFree ? 'editor-distraction-free' : ''}`}>
      <main className="editor-main">
        <div className="editor-topbar">
          <div className="editor-location">
            <button type="button" className="icon-button mobile-back" aria-label="Back to notes" onClick={onBack}><ArrowLeft size={19} /></button>
            <span className="location-root">My workspace</span><span className="location-divider">/</span><span className="location-current">{note.title || 'Untitled note'}</span>
          </div>
          <div className="editor-top-actions">
            <span className={`save-indicator ${saveStatus}`}><span className="save-dot" />{saveStatus === 'saving' ? 'Saving' : saveStatus === 'error' ? 'Save failed' : 'Saved locally'}</span>
            <button type="button" className="icon-button" aria-label={favorite ? 'Remove note from favorites' : 'Add note to favorites'} aria-pressed={favorite} title={favorite ? 'Remove favorite' : 'Favorite note'} onClick={onFavorite}><Star size={18} fill={favorite ? 'currentColor' : 'none'} /></button>
            <button type="button" className="icon-button" aria-label={pinnedNote ? 'Unpin note' : 'Pin note'} aria-pressed={pinnedNote} title={pinnedNote ? 'Unpin note' : 'Pin note'} onClick={onPinNote}><Pin size={18} fill={pinnedNote ? 'currentColor' : 'none'} /></button>
            <button type="button" className="icon-button" aria-label={bookmarked ? 'Manage note bookmark' : 'Bookmark note'} title={bookmarked ? 'Manage bookmark' : 'Bookmark note'} onClick={onBookmark}><BookmarkIcon size={18} fill={bookmarked ? 'currentColor' : 'none'} /></button>
            <button type="button" className="icon-button" aria-label="Show local graph" title="Show local graph" onClick={onLocalGraph}><Network size={18} /></button>
            <button type="button" className="icon-button details-toggle" aria-label={detailsOpen ? 'Hide note details' : 'Show note details'} title={detailsOpen ? 'Hide details' : 'Show details'} onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
            </button>
            <div className="more-wrap" ref={menuRef}>
              <button type="button" className="icon-button" aria-label="Note actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={21} /></button>
              {menuOpen && <div className="popover-menu" aria-label="Note actions">
                <button type="button" onClick={() => { setMenuOpen(false); onOpenRecorder(); }}><Mic size={16} /> Record voice note</button>
                <button type="button" onClick={() => { setMenuOpen(false); onOpenComposer(); }}><FileText size={16} /> Compose and refactor</button>
                <button type="button" onClick={() => { setMenuOpen(false); onOpenAi(); }}><Sparkles size={16} /> AI note actions</button>
                <button type="button" onClick={() => { setMenuOpen(false); onOpenHistory(); }}><RotateCcw size={16} /> Version history</button>
                <button type="button" onClick={downloadNote}><Download size={16} /> Download Markdown</button>
                <button type="button" className="danger-item" onClick={confirmDelete}><Trash2 size={16} /> Delete note</button>
              </div>}
            </div>
          </div>
        </div>

        <div className="document-scroll">
          <div className="document-inner">
            <div className="document-meta"><span className="document-type"><FileText size={14} /> NOTE</span><span>Edited {formatNoteDate(note.updatedAt)}</span></div>
            <label className="sr-only" htmlFor="note-title">Note title</label>
            <input id="note-title" className="note-title-input" maxLength={200} placeholder="Untitled note" value={note.title} onChange={(event) => onPatch(note.id, { title: event.target.value })} />
            <div className="document-subline"><span className="document-line" /><span>{stats.words} {stats.words === 1 ? 'word' : 'words'}</span></div>

            <div className="editor-controls">
              <div className="mode-switch" role="group" aria-label="Editor mode">
                <button type="button" className={mode === 'source' ? 'active' : ''} aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Source</button>
                <button type="button" className={mode === 'live' ? 'active' : ''} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live Preview</button>
                <button type="button" className={mode === 'reading' ? 'active' : ''} aria-pressed={mode === 'reading'} onClick={() => setMode('reading')}><Eye size={15} /> Reading</button>
              </div>
              {mode !== 'reading' && <div className="format-toolbar" role="toolbar" aria-label="Markdown formatting">
                <button type="button" title="Heading" aria-label="Insert heading" onClick={() => editorRef.current?.insertLinePrefix('## ')}><Heading2 size={18} /></button>
                <button type="button" title="Bold" aria-label="Bold selection" onClick={() => editorRef.current?.surroundSelection('**', '**')}><Bold size={17} /></button>
                <button type="button" title="Italic" aria-label="Italic selection" onClick={() => editorRef.current?.surroundSelection('*', '*')}><Italic size={17} /></button>
                <button type="button" title="Strikethrough" aria-label="Strikethrough selection" onClick={() => editorRef.current?.surroundSelection('~~')}>S̶</button>
                <span className="toolbar-divider" />
                <button type="button" title="Task" aria-label="Insert task" onClick={() => editorRef.current?.insertLinePrefix('- [ ] ')}><CheckSquare2 size={17} /></button>
                <button type="button" title="List" aria-label="Insert list" onClick={() => editorRef.current?.insertLinePrefix('- ')}><List size={18} /></button>
                <button type="button" title="Link" aria-label="Insert link" onClick={() => editorRef.current?.surroundSelection('[', '](https://)', 'link text')}><Link2 size={17} /></button>
                <button type="button" title="Inline code" aria-label="Inline code" onClick={() => editorRef.current?.surroundSelection('`', '`', 'code')}><Code2 size={17} /></button>
                <span className="toolbar-divider" />
                <button type="button" title="Undo" aria-label="Undo" onClick={() => editorRef.current?.undo()}><Undo2 size={17} /></button>
                <button type="button" title="Redo" aria-label="Redo" onClick={() => editorRef.current?.redo()}><Redo2 size={17} /></button>
                <button type="button" title="Find and replace" aria-label="Find and replace" onClick={() => editorRef.current?.find()}><Search size={17} /></button>
                <button type="button" title="Copy link to current block" aria-label="Copy link to current block" onClick={() => { void copyBlockLink(); }}><Copy size={17} /></button>
              </div>}
              <button type="button" className="editor-settings-toggle" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>Editor settings</button>
            </div>
            {settingsOpen && <div className="editor-settings-panel" aria-label="Editor settings">
              {(['lineNumbers', 'spellcheck', 'wordWrap', 'focusMode', 'typewriterMode'] as const).map((key) => <label key={key}><input type="checkbox" checked={preferences[key]} onChange={(event) => onPreferences({ ...preferences, [key]: event.target.checked })} /> {({ lineNumbers: 'Line numbers', spellcheck: 'Spellcheck', wordWrap: 'Word wrapping', focusMode: 'Focus mode', typewriterMode: 'Typewriter mode' })[key]}</label>)}
              <label><input type="checkbox" checked={distractionFree} onChange={(event) => setDistractionFree(event.target.checked)} /> Distraction-free mode</label>
              <label>Font <select value={preferences.fontFamily} onChange={(event) => onPreferences({ ...preferences, fontFamily: event.target.value as EditorPreferences['fontFamily'] })}><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select></label>
              <label>Font size <input type="number" min={11} max={28} value={preferences.fontSize} onChange={(event) => onPreferences({ ...preferences, fontSize: Math.min(28, Math.max(11, Number(event.target.value) || 14)) })} /></label>
              <label>Line height <input type="number" min={1.2} max={2.5} step={0.1} value={preferences.lineHeight} onChange={(event) => onPreferences({ ...preferences, lineHeight: Math.min(2.5, Math.max(1.2, Number(event.target.value) || 1.8)) })} /></label>
            </div>}
            <input ref={attachmentInputRef} type="file" className="sr-only" tabIndex={-1} aria-label="Attach file to note" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertAttachment(file); event.target.value = ''; }} />
            <div className={`editor-content-area ${mode === 'live' ? 'editor-live-grid' : ''}`}>
              <div style={mode === 'reading' ? { display: 'none' } : undefined}>
                <MarkdownEditor key={note.id} ref={editorRef} value={note.markdown} onChange={(markdown) => onPatch(note.id, { markdown })} label={`Markdown content for ${note.title || 'Untitled note'}`} preferences={preferences} suggestions={notes} onCursorChange={(line, column) => { setCursor({ line, column }); const heading = outline.filter((item) => item.line <= line).at(-1); setActiveHeading(heading?.id ?? null); }} onAttachmentRequest={requestAttachment} />
              </div>
              {mode !== 'source' && <MarkdownReadingView note={note} notes={notes} attachments={attachments} repository={repository} onOpenNote={onSelect} onOpenPdf={onOpenPdf} onCreateMissing={(target) => onCreateMissing(target, note.folderId)} onActiveHeading={setActiveHeading} />}
            </div>
          </div>
        </div>
        <div className="editor-statusbar"><span><span className="status-orb" /> {blockLinkMessage ?? 'Local workspace'}</span><span>{stats.words} words · {stats.characters} characters · {stats.readingMinutes} min read · Ln {cursor.line}, Col {cursor.column}</span></div>
      </main>

      {detailsOpen && <aside className="details-panel" aria-label="Note details">
        <div className="details-heading"><span>NOTE DETAILS</span><button type="button" className="icon-button" aria-label="Hide note details" onClick={() => setDetailsOpen(false)}><X size={17} /></button></div>
        <div className="details-section"><h3>Overview</h3>
          <div className="detail-row"><span>Created</span><strong>{formatNoteDate(note.createdAt)}</strong></div>
          <div className="detail-row"><span>Updated</span><strong>{formatNoteDate(note.updatedAt)}</strong></div>
          <div className="detail-row"><span>Words</span><strong>{stats.words}</strong></div>
          <div className="detail-row"><span>Characters</span><strong>{stats.characters}</strong></div>
          <div className="detail-row"><span>Reading time</span><strong>{stats.readingMinutes} min</strong></div>
        </div>
        <div className="details-section"><h3>Outline <span>{outline.length}</span></h3>{outline.length ? <div className="detail-links" role="navigation" aria-label="Document outline">{outline.map((item) => <button type="button" key={item.id} aria-current={activeHeading === item.id ? 'location' : undefined} style={{ paddingLeft: item.level * 7 }} onClick={() => navigateOutline(item.line, item.id)}>{item.text}</button>)}</div> : <p className="detail-empty">Add headings to navigate this note.</p>}</div>
        <PropertyPanel note={note} repository={repository} onUpdate={onUpdateProperty} onApplyDefaults={onApplyPropertyDefaults} />
        <div className="details-section"><h3>Tags <span>{tags.length}</span></h3>
          {tags.length ? <div className="detail-tags">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : <p className="detail-empty">Add <code>#tags</code> to organize this note.</p>}
        </div>
        <LinkInspector key={note.id} note={note} notes={notes} repository={repository} onSelect={onSelect} onCreateMissing={(target) => onCreateMissing(target, note.folderId)} onRefresh={onLinksChanged} />
      </aside>}
    </div>
  );
});

export function Workspace() {
  const workspace = useVaultWorkspace();
  const workspaceRepository = workspace.repository;
  const flushWorkspacePending = workspace.flushPending;
  const selectWorkspaceNote = workspace.selectNote;
  const activeVaultId = workspace.activeVault?.id;
  const cloudSync = useCloudSync(workspaceRepository, activeVaultId ?? null, workspace.refreshActive, flushWorkspacePending);
  const syncEnabled = cloudSync.enabled;
  const syncNow = cloudSync.syncNow;
  useEffect(() => {
    if (!syncEnabled || !workspace.tree) return;
    const timer = window.setTimeout(() => { void syncNow(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [syncEnabled, syncNow, workspace.tree]);
  const [graphClient] = useState(() => new GraphClient());
  const graphCloseTimer = useRef<number | null>(null);
  useEffect(() => {
    if (graphCloseTimer.current !== null) window.clearTimeout(graphCloseTimer.current);
    return () => { graphCloseTimer.current = window.setTimeout(() => graphClient.close(), 0); };
  }, [graphClient]);
  const { preferences, setPreferences } = useEditorPreferences();
  const [editorSession, setEditorSession] = useState(() => { const root = createEditorPane(); return { root: root as EditorLayoutNode, activePaneId: root.id, closedTabs: [] as { paneId: string; tab: EditorTab }[] }; });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sidebarWidths, setSidebarWidths] = useState(() => defaultWorkspaceLayout().sidebars);
  const [graphState, setGraphState] = useState(() => defaultWorkspaceLayout().graph);
  const [canvasTabs, setCanvasTabs] = useState<WorkspaceLayout['canvasTabs']>({ ids: [], activeId: null });
  const [baseTabs, setBaseTabs] = useState<WorkspaceLayout['baseTabs']>({ ids: [], activeId: null });
  const [calendarState, setCalendarState] = useState<CalendarLayout>(() => defaultWorkspaceLayout().calendar);
  const [layoutRestoreKey, setLayoutRestoreKey] = useState(0);
  const [layoutHydratedVault, setLayoutHydratedVault] = useState<string | null>(null);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [activeSavedWorkspaceId, setActiveSavedWorkspaceId] = useState<string | null>(null);
  const [startupWorkspaceId, setStartupWorkspaceId] = useState<string | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceManagerError, setWorkspaceManagerError] = useState<string | null>(null);
  const [noteSnapshots, setNoteSnapshots] = useState<Map<string, VaultNote>>(new Map());
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const editorPaneRef = useRef<EditorPaneHandle | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{ noteId: string; line: number; token: number } | null>(null);
  const lastLayoutVaultRef = useRef<string | null>(null);
  const layoutSelectedId = workspace.selectedNote?.id;
  const layoutSelectedVaultId = workspace.selectedNote?.vaultId;
  const [view, setView] = useState<View>('notes');
  const [periodKind, setPeriodKind] = useState<PeriodKind>('daily');
  const [graphScope, setGraphScope] = useState<'global' | 'local'>('global');
  const [query, setQuery] = useState('');
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [searchMode, setSearchMode] = useState<SearchMode>('lexical');
  const [semanticVaultId, setSemanticVaultId] = useState<string | null>(null);
  const semanticReady = Boolean(activeVaultId && semanticVaultId === activeVaultId);
  const [semanticProgress, setSemanticProgress] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [ocrRevision, setOcrRevision] = useState(0);
  const [transcriptTarget, setTranscriptTarget] = useState<{ id: string | null; timeMs: number } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistory>({ recent: [], saved: [] });
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileEditor, setMobileEditor] = useState(false);
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [templateAction, setTemplateAction] = useState<TemplateAction | null>(null);
  const [templateInitialId, setTemplateInitialId] = useState<string | null>(null);
  const [templateSelection, setTemplateSelection] = useState('');
  const [composerAction, setComposerAction] = useState<NoteRefactorRequest['kind'] | null>(null);
  const [composerSelection, setComposerSelection] = useState<{ from: number; to: number; text: string } | null>(null);
  const [aiAction, setAiAction] = useState<NoteActionId | null>(null);
  const [aiSelection, setAiSelection] = useState<{ from: number; to: number; text: string } | null>(null);
  const [audioRecorderOpen, setAudioRecorderOpen] = useState(false);
  const [pdfTarget, setPdfTarget] = useState<{ id: string; page: number; annotationId: string | null } | null>(null);
  const [ocrTarget, setOcrTarget] = useState<{ id: string | null; page: number } | null>(null);
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>({});
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>([]);
  const [storedBookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkLoadedVaultId, setBookmarkLoadedVaultId] = useState<string | null>(null);
  const bookmarks = bookmarkLoadedVaultId === activeVaultId ? storedBookmarks : [];
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarkBases, setBookmarkBases] = useState<{ id: string; title: string }[]>([]);
  const [bookmarkCanvases, setBookmarkCanvases] = useState<{ id: string; title: string }[]>([]);
  const [focusFolder, setFocusFolder] = useState<{ id: string; token: string } | null>(null);
  const commandDefinitions = useSyncExternalStore(commandRegistry.subscribe, commandRegistry.getSnapshot, commandRegistry.getSnapshot);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const newNoteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = workspace.activeVault?.id;
    if (!id) return;
    const timer = window.setTimeout(() => setSearchHistory(readSearchHistory(id)), 0);
    return () => window.clearTimeout(timer);
  }, [workspace.activeVault?.id]);
  const bookmarkStore = useMemo(() => workspace.repository && workspace.activeVault ? new BookmarksStore(workspace.repository, workspace.activeVault.id) : null, [workspace.repository, workspace.activeVault]);
  useEffect(() => {
    const vaultId = workspace.activeVault?.id, repository = workspace.repository;
    if (!vaultId || !repository || !bookmarkStore) return;
    let live = true;
    void Promise.all([bookmarkStore.list(), repository.listObjects('base', vaultId), repository.listObjects('canvas', vaultId)]).then(([items, bases, canvases]) => {
      if (!live) return;
      setBookmarks(items); setBookmarkLoadedVaultId(vaultId); setBookmarkBases(bases.flatMap((item) => 'title' in item && !('deletedAt' in item && item.deletedAt) ? [{ id: item.id, title: String(item.title) }] : []));
      setBookmarkCanvases(canvases.flatMap((item) => 'title' in item && !('deletedAt' in item && item.deletedAt) ? [{ id: item.id, title: String(item.title) }] : []));
      setBookmarkError(null);
    }).catch((caught: unknown) => { if (live) setBookmarkError(caught instanceof Error ? caught.message : 'Could not load bookmarks.'); });
    return () => { live = false; };
  }, [workspace.activeVault?.id, workspace.repository, bookmarkStore]);
  useEffect(() => {
    const timer = window.setTimeout(() => setShortcutOverrides(readShortcutOverrides()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const id = workspace.activeVault?.id;
    if (!id) return;
    const timer = window.setTimeout(() => setRecentNoteIds(readRecentNotes(id)), 0);
    return () => window.clearTimeout(timer);
  }, [workspace.activeVault?.id]);

  const restoreLayout = useCallback(async (input: unknown, savedId: string | null, noteIds: ReadonlySet<string>, canvasIds: ReadonlySet<string>, baseIds: ReadonlySet<string>): Promise<boolean> => {
    const repository = workspaceRepository;
    if (!repository) return false;
    const layout = reconcileWorkspaceLayout(parseWorkspaceLayout(input), noteIds, canvasIds, baseIds);
    await flushWorkspacePending();
    if (layout.editor.selectedNoteId && !await selectWorkspaceNote(layout.editor.selectedNoteId)) return false;
    if (activeVaultId && layout.editor.selectedNoteId) setRecentNoteIds(recordRecentNote(activeVaultId, layout.editor.selectedNoteId));
    const noteIdsInTabs = new Set<string>();
    const collect = (node: EditorLayoutNode) => { if (node.kind === 'split') { collect(node.children[0]); collect(node.children[1]); } else for (const tab of node.tabs) noteIdsInTabs.add(tab.noteId); };
    collect(layout.editor.root);
    const snapshots = await Promise.all([...noteIdsInTabs].map((id) => repository.getNote(id)));
    setNoteSnapshots(new Map(snapshots.filter((note): note is VaultNote => Boolean(note)).map((note) => [note.id, note])));
    setEditorSession({ root: layout.editor.root, activePaneId: layout.editor.activePaneId, closedTabs: layout.editor.closedTabs });
    setView(layout.view); setSidebarOpen(layout.sidebars.navigationOpen); setInspectorOpen(layout.sidebars.inspectorOpen);
    setSidebarWidths(layout.sidebars); setGraphScope(layout.graph.scope); setGraphState(layout.graph);
    setCanvasTabs(layout.canvasTabs); setBaseTabs(layout.baseTabs); setCalendarState(layout.calendar); setPeriodKind(layout.calendar.periodKind);
    setMobileEditor(layout.view === 'notes' && Boolean(layout.editor.selectedNoteId));
    setActiveSavedWorkspaceId(savedId); setLayoutRestoreKey((value) => value + 1);
    return true;
  }, [workspaceRepository, flushWorkspacePending, selectWorkspaceNote, activeVaultId]);

  useEffect(() => {
    const vaultId = workspace.activeVault?.id;
    const repository = workspace.repository;
    if (!vaultId || !repository || !workspace.ready || workspace.tree?.vault.id !== vaultId || lastLayoutVaultRef.current === vaultId) return;
    let live = true;
    void (async () => {
      try {
        const store = new WorkspacesStore(repository, vaultId);
        const [saved, canvases, bases] = await Promise.all([store.list(), repository.listObjects('canvas', vaultId), repository.listObjects('base', vaultId)]);
        if (!live) return;
        const startupId = readStartupWorkspaceId(vaultId);
        const startup = saved.find((item) => item.id === startupId);
        const current = readCurrentLayout(vaultId);
        const layout = startup?.layout ?? current ?? defaultWorkspaceLayout(layoutSelectedVaultId === vaultId ? layoutSelectedId : workspace.notes[0]?.id ?? null);
        const restored = await restoreLayout(layout, startup?.id ?? null, new Set(workspace.notes.map((note) => note.id)), new Set(canvases.filter((item) => !('deletedAt' in item) || !item.deletedAt).map((item) => item.id)), new Set(bases.filter((item) => !('deletedAt' in item) || !item.deletedAt).map((item) => item.id)));
        if (!live || !restored) return;
        lastLayoutVaultRef.current = vaultId;
        setSavedWorkspaces(saved); setStartupWorkspaceId(startup?.id ?? null); setLayoutHydratedVault(vaultId);
        if (startupId && !startup) writeStartupWorkspaceId(vaultId, null);
      } catch (caught) {
        if (!live) return;
        setWorkspaceManagerError(caught instanceof Error ? caught.message : 'Could not restore workspace layout.');
        try {
          const fallback = defaultWorkspaceLayout(layoutSelectedVaultId === vaultId ? layoutSelectedId : workspace.notes[0]?.id ?? null);
          if (await restoreLayout(fallback, null, new Set(workspace.notes.map((note) => note.id)), new Set(), new Set()) && live) {
            lastLayoutVaultRef.current = vaultId;
            setSavedWorkspaces([]); setStartupWorkspaceId(null); setLayoutHydratedVault(vaultId);
          }
        } catch { /* The error remains visible in the workspace manager. */ }
      }
    })();
    return () => { live = false; };
  }, [workspace.activeVault?.id, workspace.repository, workspace.ready, workspace.tree, workspace.notes, layoutSelectedId, layoutSelectedVaultId, restoreLayout]);

  const currentLayout = useMemo((): WorkspaceLayout => ({
    version: 1, view,
    editor: { root: editorSession.root, activePaneId: editorSession.activePaneId, selectedNoteId: (() => { const pane = findEditorPane(editorSession.root, editorSession.activePaneId); return pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.noteId ?? null; })(), closedTabs: editorSession.closedTabs },
    sidebars: { ...sidebarWidths, navigationOpen: sidebarOpen, inspectorOpen },
    graph: { ...graphState, scope: graphScope }, canvasTabs, baseTabs,
    calendar: { ...calendarState, periodKind },
  }), [view, editorSession.root, editorSession.activePaneId, editorSession.closedTabs, sidebarWidths, sidebarOpen, inspectorOpen, graphState, graphScope, canvasTabs, baseTabs, calendarState, periodKind]);
  useEffect(() => {
    const vaultId = workspace.activeVault?.id;
    if (!vaultId || layoutHydratedVault !== vaultId) return;
    const timer = window.setTimeout(() => {
      try { writeCurrentLayout(vaultId, currentLayout); }
      catch { setWorkspaceManagerError('Could not persist the current layout in this browser.'); }
    }, 400);
    const onPageHide = () => { try { writeCurrentLayout(vaultId, currentLayout); } catch { /* Browser storage may be unavailable during shutdown. */ } };
    window.addEventListener('pagehide', onPageHide);
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', onPageHide); };
  }, [workspace.activeVault?.id, layoutHydratedVault, currentLayout]);

  const workspaceStore = useMemo(() => workspace.repository && workspace.activeVault ? new WorkspacesStore(workspace.repository, workspace.activeVault.id) : null, [workspace.repository, workspace.activeVault]);
  const findSaved = (id: string) => savedWorkspaces.find((item) => item.id === id);
  const reportWorkspaceError = (caught: unknown): false => { setWorkspaceManagerError(caught instanceof Error ? caught.message : 'Could not change workspace.'); return false; };
  const createSavedWorkspace = async (name: string): Promise<boolean> => {
    if (!workspaceStore || layoutHydratedVault !== workspace.activeVault?.id) return false;
    try { await workspace.flushPending(); const saved = await workspaceStore.create(name, currentLayout); setSavedWorkspaces(await workspaceStore.list()); setActiveSavedWorkspaceId(saved.id); setWorkspaceManagerError(null); return true; }
    catch (caught) { return reportWorkspaceError(caught); }
  };
  const updateSavedWorkspace = async (id: string): Promise<boolean> => {
    const saved = findSaved(id); if (!workspaceStore || !saved) return false;
    try { await workspace.flushPending(); await workspaceStore.save(saved, currentLayout); setSavedWorkspaces(await workspaceStore.list()); setActiveSavedWorkspaceId(id); setWorkspaceManagerError(null); return true; }
    catch (caught) { return reportWorkspaceError(caught); }
  };
  const loadSavedWorkspace = async (id: string): Promise<boolean> => {
    const saved = findSaved(id), vaultId = workspace.activeVault?.id, repository = workspace.repository;
    if (!saved || !vaultId || !repository) return false;
    try { const [canvases, bases] = await Promise.all([repository.listObjects('canvas', vaultId), repository.listObjects('base', vaultId)]); const loaded = await restoreLayout(saved.layout, id, new Set(workspace.notes.map((note) => note.id)), new Set(canvases.filter((item) => !('deletedAt' in item) || !item.deletedAt).map((item) => item.id)), new Set(bases.filter((item) => !('deletedAt' in item) || !item.deletedAt).map((item) => item.id))); if (loaded) setWorkspaceManagerError(null); return loaded; }
    catch (caught) { return reportWorkspaceError(caught); }
  };
  const duplicateSavedWorkspace = async (id: string): Promise<boolean> => {
    const saved = findSaved(id); if (!workspaceStore || !saved) return false;
    try { await workspaceStore.duplicate(saved); setSavedWorkspaces(await workspaceStore.list()); setWorkspaceManagerError(null); return true; } catch (caught) { return reportWorkspaceError(caught); }
  };
  const renameSavedWorkspace = async (id: string, name: string): Promise<boolean> => {
    const saved = findSaved(id); if (!workspaceStore || !saved) return false;
    try { await workspaceStore.rename(saved, name); setSavedWorkspaces(await workspaceStore.list()); setWorkspaceManagerError(null); return true; } catch (caught) { return reportWorkspaceError(caught); }
  };
  const deleteSavedWorkspace = async (id: string): Promise<boolean> => {
    const saved = findSaved(id), vaultId = workspace.activeVault?.id; if (!workspaceStore || !saved || !vaultId) return false;
    try { await workspaceStore.delete(saved); setSavedWorkspaces(await workspaceStore.list()); if (activeSavedWorkspaceId === id) setActiveSavedWorkspaceId(null); if (startupWorkspaceId === id) { writeStartupWorkspaceId(vaultId, null); setStartupWorkspaceId(null); } setWorkspaceManagerError(null); return true; } catch (caught) { return reportWorkspaceError(caught); }
  };
  const setStartupWorkspace = (id: string | null): void => {
    const vaultId = workspace.activeVault?.id; if (!vaultId || id && !findSaved(id)) return;
    try { writeStartupWorkspaceId(vaultId, id); setStartupWorkspaceId(id); setWorkspaceManagerError(null); } catch (caught) { reportWorkspaceError(caught); }
  };

  useEffect(() => {
    const note = workspace.selectedNote;
    if (!note) return;
    const timer = window.setTimeout(() => setNoteSnapshots((current) => new Map(current).set(note.id, note)), 0);
    return () => window.clearTimeout(timer);
  }, [workspace.selectedNote]);
  const searchNotes = workspace.searchNotes;
  const filteredNotes = useMemo(() => {
    const visible = workspace.notes.filter((note) => !activeTag || note.tags.some((tag) => tag.toLocaleLowerCase() === activeTag.toLocaleLowerCase() || tag.toLocaleLowerCase().startsWith(`${activeTag.toLocaleLowerCase()}/`)));
    if (!query.trim()) return visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const byId = new Map(visible.map((note) => [note.id, note]));
    return (searchResults ?? []).flatMap((result) => { const note = byId.get(result.id); return note ? [note] : []; });
  }, [workspace.notes, query, activeTag, searchResults]);
  const resultsById = useMemo(() => new Map((searchResults ?? []).map((result) => [result.id, result])), [searchResults]);
  const ocrResults = useMemo(() => activeTag ? [] : (searchResults ?? []).filter((result) => result.kind === 'ocr' && workspace.attachments.some((item) => item.id === result.attachmentId)), [activeTag, searchResults, workspace.attachments]);
  const transcriptResults = useMemo(() => activeTag ? [] : (searchResults ?? []).filter((result) => result.kind === 'transcript' && workspace.attachments.some((item) => item.id === result.attachmentId)), [activeTag, searchResults, workspace.attachments]);
  const openTaskCount = workspace.notes.reduce((count, note) => count + note.taskCount, 0);
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of workspace.notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [workspace.notes]);
  const tagTree = useMemo(() => buildTagTree(workspace.notes), [workspace.notes]);

  useEffect(() => {
    const openTimestampLink = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const id = params.get('noor-transcript');
      const time = Number(params.get('t') ?? '0');
      if (id && /^[0-9a-f-]{36}$/iu.test(id) && Number.isSafeInteger(time) && time >= 0) setTranscriptTarget({ id, timeMs: time });
    };
    openTimestampLink();
    window.addEventListener('hashchange', openTimestampLink);
    return () => window.removeEventListener('hashchange', openTimestampLink);
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    if (searchMode !== 'lexical' && !semanticReady) {
      const clear = window.setTimeout(() => { setSearchResults([]); setSearchError(null); setSemanticProgress(null); }, 0);
      return () => window.clearTimeout(clear);
    }
    let active = true;
    const clear = window.setTimeout(() => { if (active) { setSearchResults(null); setSearchError(null); } }, 0);
    const timer = window.setTimeout(() => {
      void searchNotes(query, searchMode === 'lexical' ? searchSort : 'relevance', 500, searchMode, (message) => { if (active) setSemanticProgress(message); }).then((results) => { if (active) { setSearchResults(results); setSearchError(null); setSemanticProgress(null); } }).catch((error: unknown) => { if (active) { setSearchResults([]); setSearchError(error instanceof Error ? error.message : 'Search failed'); setSemanticProgress(null); } });
    }, searchMode === 'lexical' ? 180 : 400);
    return () => { active = false; window.clearTimeout(clear); window.clearTimeout(timer); };
  }, [query, searchSort, searchMode, semanticReady, searchNotes, workspace.notes, ocrRevision]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => setOfflineReady(true))
        .catch(() => undefined);
    }
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        sidebarTriggerRef.current?.focus();
      }
      if (event.key === 'Tab' && sidebarRef.current) {
        const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const openSidebar = (event: ReactMouseEvent<HTMLButtonElement>) => {
    sidebarTriggerRef.current = event.currentTarget;
    setSidebarOpen(true);
    window.requestAnimationFrame(() => newNoteRef.current?.focus());
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    sidebarTriggerRef.current?.focus();
  };

  const create = async (folderId?: string | null) => {
    const note = await workspace.addNote(folderId);
    if (!note) return;
    if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, note.id));
    setEditorSession((current) => ({ ...current, root: openEditorTab(current.root, current.activePaneId, note.id) }));
    setView('notes');
    setActiveTag(null);
    setSidebarOpen(false);
    setMobileEditor(true);
    window.setTimeout(() => document.getElementById('note-title')?.focus(), 0);
  };
  const openTemplateAction = (action: TemplateAction, initialId: string | null = null) => {
    setTemplateSelection(editorPaneRef.current?.getSelectedText() ?? '');
    setTemplateInitialId(initialId);
    setTemplateAction(action);
  };
  const openNoteComposer = (kind: NoteRefactorRequest['kind']) => {
    setComposerSelection(editorPaneRef.current?.getSelectionRange() ?? null);
    setComposerAction(kind);
  };
  const openAiNoteAction = (action: NoteActionId) => {
    setAiSelection(editorPaneRef.current?.getSelectionRange() ?? null);
    setAiAction(action);
  };
  const openTemplateSettings = () => {
    switchView('settings');
    window.setTimeout(() => document.getElementById('template-heading')?.scrollIntoView({ block: 'start' }), 0);
  };

  const selectNote = (id: string, paneId?: string, fragment?: string, lineHint?: number) => {
    void workspace.selectNote(id).then(async (opened) => {
      if (!opened) return;
      if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, id));
      if (fragment) {
        const target = await workspace.repository?.getNote(id);
        const heading = target && parseOutline(target.markdown).find((item) => headingSlug(item.text) === headingSlug(fragment) || item.id === headingSlug(fragment));
        const blockLine = target?.markdown.split('\n').findIndex((line) => line.includes(`^${fragment}`)) ?? -1;
        const line = heading?.line ?? (blockLine >= 0 ? blockLine + 1 : lineHint ?? null);
        setNavigationTarget(line ? { noteId: id, line, token: Date.now() } : null);
      } else setNavigationTarget(lineHint ? { noteId: id, line: lineHint, token: Date.now() } : null);
      setEditorSession((current) => { const target = paneId && findEditorPane(current.root, paneId) ? paneId : current.activePaneId; return { ...current, root: openEditorTab(current.root, target, id), activePaneId: target }; });
      setView('notes');
      setMobileEditor(true);
      setSidebarOpen(false);
      window.setTimeout(() => document.getElementById('note-title')?.focus(), 0);
    });
  };
  const createMissingNote = (target: string, folderId: string | null) => {
    void workspace.createLinkedNote(target, folderId).then((created) => { if (created) selectNote(created.id); });
  };
  const openQuickNote = async (id: string, mode: 'current' | 'tab' | 'split'): Promise<boolean> => {
    if (!await workspace.selectNote(id)) return false;
    if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, id));
    setEditorSession((current) => {
      if (mode === 'split') {
        const next = splitEditorPane(current.root, current.activePaneId, 'vertical', id);
        return { ...current, root: next.root, activePaneId: next.newPaneId };
      }
      return { ...current, root: openEditorTab(current.root, current.activePaneId, id, mode === 'tab') };
    });
    setView('notes'); setMobileEditor(true); setSidebarOpen(false);
    return true;
  };
  const createQuickNote = async (target: string): Promise<boolean> => {
    const created = await workspace.createLinkedNote(target, workspace.selectedFolderId);
    return created ? openQuickNote(created.id, 'current') : false;
  };

  const reportBookmarkError = (caught: unknown): false => { setBookmarkError(caught instanceof Error ? caught.message : 'Could not change bookmark.'); return false; };
  const refreshBookmarks = async (): Promise<void> => { if (bookmarkStore && activeVaultId) { setBookmarks(await bookmarkStore.list()); setBookmarkLoadedVaultId(activeVaultId); } };
  const createBookmark = async (draft: BookmarkDraft): Promise<boolean> => {
    if (!bookmarkStore) return false;
    try { await workspace.flushPending(); await bookmarkStore.create(draft); await refreshBookmarks(); setBookmarkError(null); return true; } catch (caught) { return reportBookmarkError(caught); }
  };
  const updateBookmark = async (item: Bookmark, patch: Partial<BookmarkDraft>): Promise<boolean> => {
    if (!bookmarkStore) return false;
    try { await bookmarkStore.update(item, patch); await refreshBookmarks(); setBookmarkError(null); return true; } catch (caught) { return reportBookmarkError(caught); }
  };
  const removeBookmark = async (item: Bookmark): Promise<boolean> => {
    if (!bookmarkStore) return false;
    try { await bookmarkStore.remove(item); await refreshBookmarks(); setBookmarkError(null); return true; } catch (caught) { return reportBookmarkError(caught); }
  };
  const toggleNoteFlag = async (noteId: string, flag: 'favorite' | 'pinned'): Promise<boolean> => {
    if (!bookmarkStore) return false;
    try { await bookmarkStore.toggleNoteFlag(noteId, flag); await refreshBookmarks(); setBookmarkError(null); return true; } catch (caught) { return reportBookmarkError(caught); }
  };
  const openBookmarkManager = () => {
    setBookmarkManagerOpen(true);
    const vaultId = workspace.activeVault?.id, repository = workspace.repository;
    if (!vaultId || !repository) return;
    void Promise.all([repository.listObjects('base', vaultId), repository.listObjects('canvas', vaultId)]).then(([bases, canvases]) => {
      setBookmarkBases(bases.flatMap((item) => 'title' in item && !('deletedAt' in item && item.deletedAt) ? [{ id: item.id, title: String(item.title) }] : []));
      setBookmarkCanvases(canvases.flatMap((item) => 'title' in item && !('deletedAt' in item && item.deletedAt) ? [{ id: item.id, title: String(item.title) }] : []));
    }).catch((caught: unknown) => { reportBookmarkError(caught); });
  };
  const openBookmark = (item: Bookmark) => {
    if (item.kind === 'note' || item.kind === 'heading' || item.kind === 'block') {
      if (!item.noteId || !workspace.notes.some((note) => note.id === item.noteId)) { setBookmarkError('This bookmarked note is missing.'); return; }
      selectNote(item.noteId, undefined, item.fragment); setBookmarkManagerOpen(false); return;
    }
    if (item.kind === 'search' && item.query) { setQuery(item.query); setActiveTag(null); setView('notes'); setMobileEditor(false); setBookmarkManagerOpen(false); if (workspace.activeVault) setSearchHistory(addRecentSearch(workspace.activeVault.id, item.query)); return; }
    if (item.kind === 'base' && item.resourceId) { if (!bookmarkBases.some((base) => base.id === item.resourceId)) { setBookmarkError('This bookmarked Base is missing.'); return; } setBaseTabs((current) => ({ ids: current.ids.includes(item.resourceId!) ? current.ids : [...current.ids, item.resourceId!], activeId: item.resourceId! })); setView('bases'); setLayoutRestoreKey((value) => value + 1); setBookmarkManagerOpen(false); return; }
    if (item.kind === 'canvas' && item.resourceId) { if (!bookmarkCanvases.some((canvas) => canvas.id === item.resourceId)) { setBookmarkError('This bookmarked Canvas is missing.'); return; } setCanvasTabs((current) => ({ ids: current.ids.includes(item.resourceId!) ? current.ids : [...current.ids, item.resourceId!], activeId: item.resourceId! })); setView('canvas'); setLayoutRestoreKey((value) => value + 1); setBookmarkManagerOpen(false); return; }
    if (item.kind === 'url' && item.url) { window.open(item.url, '_blank', 'noopener,noreferrer'); return; }
    setBookmarkError('This bookmark target is unavailable.');
  };

  const activateTab = async (paneId: string, tab: EditorTab) => {
    if (!await workspace.selectNote(tab.noteId)) return;
    if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, tab.noteId));
    setEditorSession((current) => ({ ...current, root: activateEditorTab(current.root, paneId, tab.id), activePaneId: paneId }));
    setView('notes');
    setMobileEditor(true);
  };
  const closeTab = async (paneId: string, tabId: string) => {
    const result = closeEditorTab(editorSession.root, paneId, tabId);
    if (!result.closed) return;
    const pane = findEditorPane(result.root, paneId);
    const next = pane?.tabs.find((tab) => tab.id === pane.activeTabId);
    if (paneId === editorSession.activePaneId && next && !await workspace.selectNote(next.noteId)) return;
    if (paneId === editorSession.activePaneId && next && workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, next.noteId));
    setEditorSession((current) => ({ ...current, root: closeEditorTab(current.root, paneId, tabId).root, closedTabs: [...current.closedTabs, { paneId, tab: result.closed! }].slice(-20) }));
  };
  const restoreClosedTab = async (index = editorSession.closedTabs.length - 1) => {
    const closed = editorSession.closedTabs[index];
    if (!closed || !workspace.notes.some((note) => note.id === closed.tab.noteId)) return;
    if (!await workspace.selectNote(closed.tab.noteId)) return;
    if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, closed.tab.noteId));
    setEditorSession((current) => {
      const entry = current.closedTabs.find((item) => item.tab.id === closed.tab.id);
      if (!entry) return current;
      const paneId = findEditorPane(current.root, entry.paneId) ? entry.paneId : current.activePaneId;
      return { ...current, root: openEditorTab(current.root, paneId, entry.tab.noteId, true), activePaneId: paneId, closedTabs: current.closedTabs.filter((item) => item.tab.id !== entry.tab.id) };
    });
    setView('notes'); setMobileEditor(true);
  };
  const splitPane = (paneId: string, direction: 'vertical' | 'horizontal') => {
    setEditorSession((current) => ({ ...current, root: splitEditorPane(current.root, paneId, direction).root }));
  };
  const removePane = async (paneId: string) => {
    const root = closeEditorPane(editorSession.root, paneId);
    const nextPane = firstEditorPane(root);
    const nextTab = nextPane.tabs.find((tab) => tab.id === nextPane.activeTabId);
    if (paneId === editorSession.activePaneId && nextTab && !await workspace.selectNote(nextTab.noteId)) return;
    if (paneId === editorSession.activePaneId && nextTab && workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, nextTab.noteId));
    setEditorSession((current) => { const updated = closeEditorPane(current.root, paneId); return { ...current, root: updated, activePaneId: paneId === current.activePaneId ? firstEditorPane(updated).id : current.activePaneId }; });
  };
  const deleteOpenNote = async (id: string) => {
    await workspace.removeNote(id);
    const stored = await workspace.repository?.getNote(id);
    if (stored && !stored.deletedAt) return;
    const updated = removeNoteFromEditorLayout(editorSession.root, id);
    const pane = findEditorPane(updated, editorSession.activePaneId) ?? firstEditorPane(updated);
    const next = pane.tabs.find((tab) => tab.id === pane.activeTabId);
    setEditorSession((current) => ({ ...current, root: removeNoteFromEditorLayout(current.root, id), closedTabs: current.closedTabs.filter((entry) => entry.tab.noteId !== id) }));
    if (next) await workspace.selectNote(next.noteId);
  };

  const switchView = (next: View) => {
    setView(next);
    setSidebarOpen(false);
    setMobileEditor(false);
    if (next === 'notes') setActiveTag(null);
    if (sidebarOpen) window.setTimeout(() => document.querySelector<HTMLButtonElement>('.collection-topbar .mobile-menu, .list-topbar .mobile-menu')?.focus(), 0);
  };
  const showGraph = (scope: 'global' | 'local') => { setGraphScope(scope); switchView('graph'); };
  const showLocalGraphFor = async (id: string) => {
    if (!await workspace.selectNote(id)) return;
    if (workspace.activeVault) setRecentNoteIds(recordRecentNote(workspace.activeVault.id, id));
    setEditorSession((current) => ({ ...current, root: openEditorTab(current.root, current.activePaneId, id) }));
    setGraphScope('local');
  };

  const focusSearch = () => {
    setView('notes');
    setActiveTag(null);
    setSidebarOpen(false);
    setMobileEditor(false);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const exportAll = () => {
    void workspace.exportZip();
  };

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    const count = await workspace.importFiles(event.target.files);
    if (count) { setImportCount(count); setView('notes'); setActiveTag(null); setMobileEditor(true); }
    event.target.value = '';
  };

  const activePane = findEditorPane(editorSession.root, editorSession.activePaneId);
  const activeTab = activePane?.tabs.find((tab) => tab.id === activePane.activeTabId);
  const moveTab = (step: -1 | 1) => {
    if (!activePane?.tabs.length || !activeTab) return;
    const index = activePane.tabs.findIndex((tab) => tab.id === activeTab.id);
    const next = activePane.tabs[(index + step + activePane.tabs.length) % activePane.tabs.length];
    if (next) void activateTab(activePane.id, next);
  };
  const commandAvailability: CommandAvailability = { hasNote: Boolean(workspace.selectedNote), hasEditor: view === 'notes' && Boolean(activeTab && workspace.selectedNote), hasTab: Boolean(activeTab), hasClosedTab: editorSession.closedTabs.length > 0, hasSplit: editorSession.root.kind === 'split' };
  const commandContext: CommandContext = {
    ...commandAvailability,
    openQuickSwitcher: () => setSwitcherOpen(true), openPalette: () => setCommandOpen(true),
    createNote: () => { void create(); }, focusSearch, showNotes: () => switchView('notes'), showTasks: () => switchView('tasks'), showTags: () => switchView('tags'), showGlobalGraph: () => showGraph('global'), showLocalGraph: () => showGraph('local'), showBases: () => switchView('bases'), showCanvas: () => switchView('canvas'), showTrash: () => switchView('trash'), showSettings: () => switchView('settings'),
    insertTemplate: () => openTemplateAction('insert'), createFromTemplate: () => openTemplateAction('create'), applyTemplateProperties: () => openTemplateAction('properties'), previewTemplate: () => openTemplateAction('preview'), createDailyNote: () => { void workspace.createDailyNote().then((note) => { if (note) selectNote(note.id); }); }, showPeriodNotes: (kind) => { setPeriodKind(kind); switchView('periods'); },
    importFiles: () => fileRef.current?.click(), exportVault: exportAll,
    closeTab: () => { if (activeTab && activePane) void closeTab(activePane.id, activeTab.id); },
    restoreTab: () => { void restoreClosedTab(); }, nextTab: () => moveTab(1), previousTab: () => moveTab(-1),
    pinTab: () => { if (activeTab && activePane) setEditorSession((current) => ({ ...current, root: pinEditorTab(current.root, activePane.id, activeTab.id) })); },
    splitVertical: () => splitPane(editorSession.activePaneId, 'vertical'), splitHorizontal: () => splitPane(editorSession.activePaneId, 'horizontal'),
    closePane: () => { void removePane(editorSession.activePaneId); },
    duplicateNote: () => { if (workspace.selectedNote) void workspace.duplicateNote(workspace.selectedNote.id).then((note) => { if (note) void openQuickNote(note.id, 'current'); }); },
    openAudioRecorder: () => setAudioRecorderOpen(true),
    openNoteComposer,
    openAiNoteAction,
    manageWorkspaces: () => setWorkspaceManagerOpen(true),
    saveWorkspace: () => { if (activeSavedWorkspaceId) void updateSavedWorkspace(activeSavedWorkspaceId); else setWorkspaceManagerOpen(true); },
    loadWorkspace: () => setWorkspaceManagerOpen(true),
    duplicateWorkspace: () => { if (activeSavedWorkspaceId) void duplicateSavedWorkspace(activeSavedWorkspaceId); else setWorkspaceManagerOpen(true); },
    renameWorkspace: () => setWorkspaceManagerOpen(true),
    deleteWorkspace: () => setWorkspaceManagerOpen(true),
    setStartupWorkspace: () => { if (activeSavedWorkspaceId) setStartupWorkspace(activeSavedWorkspaceId); else setWorkspaceManagerOpen(true); },
    manageBookmarks: openBookmarkManager,
    bookmarkCurrentNote: () => { const note = workspace.selectedNote; if (!note) return; if (bookmarks.some((item) => item.kind === 'note' && item.noteId === note.id)) { openBookmarkManager(); return; } void createBookmark({ kind: 'note', title: note.title || 'Untitled note', parentId: null, noteId: note.id }); },
    toggleFavoriteNote: () => { if (workspace.selectedNote) void toggleNoteFlag(workspace.selectedNote.id, 'favorite'); },
    togglePinnedNote: () => { if (workspace.selectedNote) void toggleNoteFlag(workspace.selectedNote.id, 'pinned'); },
    runEditorAction: (action) => editorPaneRef.current?.run(action),
  };
  const changeShortcut = (id: string, value: string | null | undefined): string | null => {
    const command = commandRegistry.get(id);
    if (!command) return 'Command is no longer available.';
    const next = { ...shortcutOverrides };
    if (value === undefined) delete next[id];
    else if (value === null) next[id] = null;
    else {
      const normalized = normalizeShortcut(value);
      if (!normalized) return 'Press a modifier and a supported key.';
      next[id] = normalized;
    }
    const effective = effectiveShortcut(command, next);
    if (effective) {
      const conflict = shortcutConflict(commandDefinitions, next, id, effective);
      if (conflict) return `${effective} is already assigned to ${conflict.name}.`;
    }
    try { writeShortcutOverrides(next); setShortcutOverrides(next); return null; }
    catch { return 'Could not save keyboard shortcuts in this browser.'; }
  };
  const commands: CommandItem[] = commandDefinitions.map((command) => ({
    id: command.id, label: command.name, description: command.category, shortcut: effectiveShortcut(command, shortcutOverrides)?.replace('Mod', 'Ctrl/⌘') ?? undefined,
    disabled: Boolean(command.available && !command.available(commandAvailability)), onSelect: () => { void commandRegistry.execute(command.id, commandContext); },
  }));

  const commandContextRef = useRef<CommandContext | null>(null);
  useEffect(() => { commandContextRef.current = commandContext; });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return;
      for (const command of commandDefinitions) {
        const shortcut = effectiveShortcut(command, shortcutOverrides);
        if (!shortcut || !matchesShortcut(event, shortcut)) continue;
        event.preventDefault();
        const context = commandContextRef.current;
        if (context && (!command.available || command.available(context))) void commandRegistry.execute(command.id, context);
        break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandDefinitions, shortcutOverrides]);

  const renderEditorNode = (node: EditorLayoutNode): React.ReactNode => {
    if (node.kind === 'split') return <div key={node.id} className={`editor-split editor-split-${node.direction}`}>
      {renderEditorNode(node.children[0])}{renderEditorNode(node.children[1])}
    </div>;
    const activeTab = node.tabs.find((tab) => tab.id === node.activeTabId);
    const noteId = activeTab?.noteId;
    const note = noteId ? workspace.selectedNote?.id === noteId ? workspace.selectedNote : noteSnapshots.get(noteId) : null;
    const editable = node.id === editorSession.activePaneId && noteId === workspace.selectedNote?.id;
    return <section key={node.id} className={`editor-pane-shell ${editable ? 'editor-pane-active' : ''}`} aria-label="Editor pane">
      <div className="editor-tabstrip">
        <div className="editor-tabs" role="tablist" aria-label="Open notes">
          {node.tabs.map((tab) => <div key={tab.id} className={`editor-tab ${tab.id === node.activeTabId ? 'active' : ''}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-noor-note-tab', JSON.stringify({ paneId: node.id, tabId: tab.id })); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); try { const drag: unknown = JSON.parse(event.dataTransfer.getData('application/x-noor-note-tab')); if (typeof drag === 'object' && drag !== null && 'paneId' in drag && 'tabId' in drag && drag.paneId === node.id && typeof drag.tabId === 'string') setEditorSession((current) => ({ ...current, root: reorderEditorTab(current.root, node.id, drag.tabId as string, tab.id) })); } catch { /* Ignore data from outside the tab strip. */ } }}>
            <button type="button" role="tab" aria-selected={tab.id === node.activeTabId} title={workspace.notes.find((item) => item.id === tab.noteId)?.path} onClick={() => { void activateTab(node.id, tab); }}>{tab.pinned && <Pin size={12} />}<span>{workspace.notes.find((item) => item.id === tab.noteId)?.title || noteSnapshots.get(tab.noteId)?.title || 'Untitled note'}</span></button>
            <button type="button" className="editor-tab-action" aria-label={tab.pinned ? 'Unpin tab' : 'Pin tab'} aria-pressed={tab.pinned} onClick={() => setEditorSession((current) => ({ ...current, root: pinEditorTab(current.root, node.id, tab.id) }))}><Pin size={12} /></button>
            <button type="button" className="editor-tab-action" aria-label="Duplicate tab" onClick={() => setEditorSession((current) => ({ ...current, root: openEditorTab(current.root, node.id, tab.noteId, true) }))}><Copy size={12} /></button>
            <button type="button" className="editor-tab-action" aria-label="Close tab" onClick={() => { void closeTab(node.id, tab.id); }}><X size={13} /></button>
          </div>)}
        </div>
        <div className="editor-pane-actions">
          <button type="button" aria-label="Restore closed tab" title="Restore closed tab" disabled={!editorSession.closedTabs.length} onClick={() => { void restoreClosedTab(); }}><RotateCcw size={15} /></button>
          <button type="button" aria-label="Split pane vertically" title="Split vertically" onClick={() => splitPane(node.id, 'vertical')}><Columns2 size={15} /></button>
          <button type="button" aria-label="Split pane horizontally" title="Split horizontally" onClick={() => splitPane(node.id, 'horizontal')}><Rows2 size={15} /></button>
          {editorSession.root.kind === 'split' && <button type="button" aria-label="Close pane" title="Close pane" onClick={() => { void removePane(node.id); }}><X size={15} /></button>}
        </div>
      </div>
      <div className="editor-pane-content">
        {note && editable ? <EditorPane key={note.id} ref={editorPaneRef} note={note} notes={workspace.notes} attachments={workspace.attachments} repository={workspace.repository} saveStatus={workspace.saveStatus} onPatch={workspace.patchNote} onDelete={(id) => { void deleteOpenNote(id); }} onSelect={(id, fragment) => selectNote(id, node.id, fragment)} onBack={() => setMobileEditor(false)} onLocalGraph={() => showGraph('local')} mobileEditor={mobileEditor} preferences={preferences} onPreferences={setPreferences} onAddAttachment={workspace.addAttachment} onCreateMissing={createMissingNote} onLinksChanged={workspace.refreshActive} onUpdateProperty={workspace.updateProperty} onApplyPropertyDefaults={workspace.applyPropertyDefaults} navigationTarget={navigationTarget} detailsOpen={inspectorOpen} setDetailsOpen={setInspectorOpen} favorite={bookmarks.some((item) => item.kind === 'note' && item.noteId === note.id && item.favorite)} pinnedNote={bookmarks.some((item) => item.kind === 'note' && item.noteId === note.id && item.pinned)} bookmarked={bookmarks.some((item) => item.kind === 'note' && item.noteId === note.id)} onFavorite={() => { void toggleNoteFlag(note.id, 'favorite'); }} onPinNote={() => { void toggleNoteFlag(note.id, 'pinned'); }} onBookmark={() => { if (bookmarks.some((item) => item.kind === 'note' && item.noteId === note.id)) openBookmarkManager(); else void createBookmark({ kind: 'note', title: note.title || 'Untitled note', parentId: null, noteId: note.id }); }} onOpenComposer={() => openNoteComposer('merge')} onOpenAi={() => openAiNoteAction('summarize-note')} onOpenRecorder={() => setAudioRecorderOpen(true)} onOpenHistory={() => setHistoryNoteId(note.id)} onOpenPdf={(id, page, annotationId) => setPdfTarget({ id, page, annotationId })} /> :
          note ? <div className="editor-inactive-pane"><div className="editor-inactive-header"><strong>{note.title || 'Untitled note'}</strong><button type="button" onClick={() => { if (activeTab) void activateTab(node.id, activeTab); }}>Activate to edit</button></div><MarkdownReadingView note={note} notes={workspace.notes} attachments={workspace.attachments} repository={workspace.repository} onOpenNote={(id, fragment) => selectNote(id, node.id, fragment)} onOpenPdf={(id, page, annotationId) => setPdfTarget({ id, page, annotationId })} onCreateMissing={(target) => createMissingNote(target, note.folderId)} /></div> :
          <div className="editor-pane-empty">Open a note from the list or file explorer.</div>}
      </div>
    </section>;
  };

  return (
    <div className="app-shell" style={{ '--nn-nav-width': `${sidebarWidths.navigationWidth}px`, '--nn-note-list-width': `${sidebarWidths.noteListWidth}px`, '--nn-inspector-width': `${sidebarWidths.inspectorWidth}px` } as CSSProperties}>
      <input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept=".md,.json,.zip,text/markdown,application/json,application/zip" multiple onChange={onImport} aria-label="Import Markdown, ZIP, or Noor Note files" />
      <ActivityBar view={view} onNavigate={(next) => next === 'graph' ? showGraph('global') : switchView(next)} onSearch={focusSearch} onCommand={() => { void commandRegistry.execute('navigation.command-palette', commandContext); }} />
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={closeSidebar} />}
      <aside ref={sidebarRef} className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Primary navigation">
        <div className="brand-block"><BrandMark /><div><div className="brand-name">Noor Note<span className="brand-period">.</span></div><div className="brand-caption">A brighter place to think</div></div></div>
        <div className="sidebar-body">
          <button ref={newNoteRef} type="button" className="new-note-button" onClick={() => void create()}><Plus size={19} strokeWidth={2.3} /> New note <span>{effectiveShortcut(commandRegistry.get('notes.new')!, shortcutOverrides)?.replace('Mod', 'Ctrl/⌘') ?? ''}</span></button>
          <div className="nav-label">WORKSPACE</div>
          <nav className="primary-nav" aria-label="Workspace">
            <button type="button" className={view === 'notes' && !activeTag ? 'active' : ''} onClick={() => switchView('notes')}><BookOpenText size={19} /> All notes <span>{workspace.notes.length}</span></button>
            <button type="button" className={view === 'periods' ? 'active' : ''} onClick={() => switchView('periods')}><CalendarDays size={19} /> Calendar</button>
            <button type="button" className={view === 'tasks' ? 'active' : ''} onClick={() => switchView('tasks')}><CheckSquare2 size={19} /> Tasks <span>{openTaskCount}</span></button>
            <button type="button" className={view === 'tags' || activeTag ? 'active' : ''} onClick={() => switchView('tags')}><Tags size={19} /> Tags <span>{allTags.length}</span></button>
            <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => showGraph('global')}><Network size={19} /> Graph</button>
            <button type="button" className={view === 'bases' ? 'active' : ''} onClick={() => switchView('bases')}><Database size={19} /> Bases</button>
            <button type="button" className={view === 'canvas' ? 'active' : ''} onClick={() => switchView('canvas')}><PanelsTopLeft size={19} /> Canvas</button>
            <button type="button" className={view === 'chat' ? 'active' : ''} onClick={() => switchView('chat')}><MessageSquareText size={19} /> Vault chat</button>
            <button type="button" className={view === 'organize' ? 'active' : ''} onClick={() => switchView('organize')}><Sparkles size={19} /> Organize knowledge</button>
            <button type="button" onClick={openBookmarkManager}><BookmarkIcon size={19} /> Bookmarks</button>
            <button type="button" onClick={() => setWorkspaceManagerOpen(true)}><Columns2 size={19} /> Workspaces{savedWorkspaces.length > 0 && <span>{savedWorkspaces.length}</span>}</button>
            <button type="button" className={view === 'trash' ? 'active' : ''} onClick={() => switchView('trash')}><Trash2 size={19} /> Trash</button>
            <button type="button" className={view === 'settings' ? 'active' : ''} onClick={() => switchView('settings')}><ShieldCheck size={19} /> Settings</button>
          </nav>
          <VaultExplorer workspace={workspace} focusFolder={focusFolder} onSelectNote={selectNote} onCreateNote={(folderId) => { void create(folderId); }} onOpenTrash={() => switchView('trash')} onOpenPdf={(id) => setPdfTarget({ id, page: 1, annotationId: null })} onOpenOcr={(id) => setOcrTarget({ id: id ?? null, page: 1 })} onOpenTranscript={(id) => setTranscriptTarget({ id: id ?? null, timeMs: 0 })} onImported={(count) => { if (count) setImportCount(count); }} />
          <div className="sidebar-rule" />
          <div className="nav-label">YOUR DATA</div>
          <div className="secondary-nav">
            <button type="button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Import files</button>
            <button type="button" onClick={exportAll}><Download size={18} /> Export vault ZIP</button>
          </div>
        </div>
        <div className="sidebar-footer"><div className="privacy-icon"><ShieldCheck size={20} /></div><div><strong>Yours, always.</strong><span>Notes live in this browser.</span></div></div>
      </aside>

      <div className="shell-workspace">
      <div className={`workspace-body ${view !== 'notes' ? 'wide-view' : ''} ${mobileEditor ? 'show-mobile-editor' : ''}`}>
        {view === 'notes' && <section className="note-list-panel" aria-label="Notes">
          <div className="list-topbar"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={openSidebar}><Menu size={21} /></button><span>My workspace</span><ChevronDown size={15} /></div>
          <div className="list-heading"><div><span className="eyebrow">COLLECTION</span><h2>{activeTag ? `#${activeTag}` : 'All notes'}</h2></div><div className="list-heading-actions"><button type="button" className="list-add-button" aria-label="Open quick switcher" title="Quick switcher · Ctrl/⌘ O" onClick={() => setSwitcherOpen(true)}><Search size={18} /></button><button type="button" className="list-add-button" aria-label="Create note" onClick={() => void create()}><Plus size={19} /></button></div></div>
          <label className="search-field"><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && workspace.activeVault && query.trim()) setSearchHistory(addRecentSearch(workspace.activeVault.id, query)); }} placeholder="Search your notes" aria-label="Search notes" /></label>
          <SearchTools query={query} sort={searchSort} mode={searchMode} onMode={(mode) => { setSearchMode(mode); setSearchSort('relevance'); }} semanticReady={semanticReady} onStartSemantic={() => setSemanticVaultId(activeVaultId ?? null)} progress={semanticProgress} history={searchHistory} error={query.trim() ? searchError : null} loading={Boolean(query.trim()) && searchResults === null && (searchMode === 'lexical' || semanticReady)} onSort={setSearchSort} onQuery={(value) => setQuery(value)} onSave={() => { if (workspace.activeVault) setSearchHistory(toggleSavedSearch(workspace.activeVault.id, query)); }} />
          {activeTag && <button type="button" className="clear-filter" onClick={() => setActiveTag(null)}>Showing #{activeTag} <X size={14} /></button>}
          <div className="list-summary"><span>{filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}{query.trim() && ocrResults.length ? ` · ${ocrResults.length} OCR pages` : ''}{query.trim() && transcriptResults.length ? ` · ${transcriptResults.length} transcript segments` : ''}</span><span>RECENTLY EDITED</span></div>
          <div className="note-list-scroll">
            {!workspace.ready ? <div className="list-message">Opening your workspace…</div> : query.trim() && searchResults === null ? <div className="list-message">Searching local notes…</div> : filteredNotes.length ? filteredNotes.map((note) => <button type="button" key={note.id} className={`note-card ${workspace.selectedId === note.id ? 'selected' : ''}`} onClick={() => selectNote(note.id, undefined, undefined, resultsById.get(note.id)?.line)}>
              <div className="note-card-top"><FileText size={16} /><span>{formatNoteDate(note.updatedAt)}</span></div>
              <strong>{note.title || 'Untitled note'}</strong>{query.trim() && resultsById.get(note.id) ? <SearchSnippet result={resultsById.get(note.id)!} /> : <p>{note.excerpt || 'No content yet'}</p>}
              {note.tags.length > 0 && <div className="note-card-tags">{note.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
            </button>) : null}
            {query.trim() && ocrResults.map((result) => <button type="button" key={result.id} className="note-card" onClick={() => setOcrTarget({ id: result.attachmentId ?? null, page: result.page ?? 1 })}><div className="note-card-top"><FileText size={16} /><span>OCR · page {result.page ?? 1}</span></div><strong>{result.title}</strong><SearchSnippet result={result} /></button>)}
            {query.trim() && transcriptResults.map((result) => <button type="button" key={result.id} className="note-card" onClick={() => setTranscriptTarget({ id: result.attachmentId ?? null, timeMs: result.timeMs ?? 0 })}><div className="note-card-top"><Mic size={16} /><span>Transcript · {Math.floor((result.timeMs ?? 0) / 60000)}:{String(Math.floor((result.timeMs ?? 0) / 1000) % 60).padStart(2, '0')}</span></div><strong>{result.title}</strong><SearchSnippet result={result} /></button>)}
            {workspace.ready && (!query.trim() || searchResults !== null) && !filteredNotes.length && !ocrResults.length && !transcriptResults.length && !(query.trim() && searchMode !== 'lexical' && !semanticReady) && (query || activeTag ? <div className="list-message">No notes match this search.</div> : <><div className="list-message empty-list-message">Your notes will appear here.</div><div className="mobile-empty-cta"><BrandMark size={42} /><strong>Start with one idea.</strong><p>Your notes stay on this device. You can export them as Markdown whenever you like.</p><button type="button" className="button-primary" onClick={() => void create()}><Plus size={17} /> Create your first note</button></div></>)}
          </div>
          <div className="list-footer"><span className="footer-live-dot" /> {online ? offlineReady ? 'Ready offline' : 'Local workspace' : 'Working offline'} <span>·</span> Stored locally</div>
        </section>}

        {view === 'notes' ? (workspace.notes.length ? renderEditorNode(editorSession.root) : <main className="empty-main"><div className="empty-topbar"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={openSidebar}><Menu size={21} /></button><span>My workspace</span><span className="empty-top-status"><span /> Local-first workspace</span></div><EmptyNotes onCreate={() => void create()} /></main>) : view === 'trash' && workspace.activeVault ?
          <TrashView vaultId={workspace.activeVault.id} repository={workspace.repository} onOpenNavigation={openSidebar} onChanged={workspace.refreshActive} /> : view === 'graph' && workspace.activeVault ?
          <GraphView key={`${workspace.activeVault.id}:${layoutRestoreKey}`} vaultId={workspace.activeVault.id} notes={workspace.notes} attachments={workspace.attachments} selectedNote={workspace.selectedNote} repository={workspace.repository} client={graphClient} scope={graphScope} onScopeChange={setGraphScope} initialState={graphState} onStateChange={setGraphState} onOpenNote={(id, mode) => { void openQuickNote(id, mode); }} onShowLocalGraph={(id) => { void showLocalGraphFor(id); }} onFilterTag={(tag) => { setActiveTag(tag); setQuery(''); setView('notes'); setMobileEditor(false); }} onOpenNavigation={openSidebar} /> : view === 'settings' ?
          <SettingsView workspace={workspace} sync={cloudSync} onImport={() => fileRef.current?.click()} onExport={exportAll} onBack={() => switchView('notes')} onOpenNote={selectNote} onPreviewTemplate={(id) => openTemplateAction('preview', id)} onOpenNavigation={openSidebar} commands={commandDefinitions} shortcutOverrides={shortcutOverrides} onShortcutChange={changeShortcut} /> :
          view === 'bases' && workspace.activeVault ? <BasesView key={`${workspace.activeVault.id}:${layoutRestoreKey}`} workspace={workspace} initialTabs={baseTabs} onTabsChange={setBaseTabs} onOpenNote={selectNote} onCreateFromBase={(baseId, folderId) => { void workspace.addNote(folderId, { baseId }).then((note) => { if (note) selectNote(note.id); }); }} onOpenNavigation={openSidebar} /> :
          view === 'canvas' && workspace.activeVault ? <CanvasView key={`${workspace.activeVault.id}:${layoutRestoreKey}`} workspace={workspace} initialTabs={canvasTabs} onTabsChange={setCanvasTabs} onOpenNote={selectNote} onOpenNavigation={openSidebar} /> :
          view === 'periods' && workspace.activeVault ? <IntegratedCalendar key={`${workspace.activeVault.id}:${layoutRestoreKey}`} workspace={workspace} periodKind={periodKind} onPeriodKindChange={setPeriodKind} initialState={calendarState} onStateChange={setCalendarState} onOpenNote={(id, line) => selectNote(id, undefined, undefined, line)} onOpenNavigation={openSidebar} onSettings={() => switchView('settings')} /> :
          view === 'tasks' && workspace.activeVault ? <TaskDashboard key={workspace.activeVault.id} workspace={workspace} onOpenNote={(id, line, blockId) => selectNote(id, undefined, blockId ?? undefined, line)} onOpenNavigation={openSidebar} /> :
          view === 'chat' && workspace.activeVault ? <VaultChat key={workspace.activeVault.id} workspace={workspace} onOpenSource={(source) => { void workspace.repository?.getNote(source.noteId).then((note) => { if (!note) return; const offset = note.markdown.indexOf(source.excerpt); const line = offset >= 0 ? note.markdown.slice(0, offset).split('\n').length : source.line; selectNote(source.noteId, undefined, offset >= 0 ? undefined : source.blockId ?? source.heading ?? undefined, line); }); }} onOpenNavigation={openSidebar} onOpenSettings={() => switchView('settings')} /> :
          view === 'organize' && workspace.activeVault ? <OrganizationReview key={workspace.activeVault.id} workspace={workspace} onOpenNote={selectNote} onOpenNavigation={openSidebar} onOpenSettings={() => switchView('settings')} /> :
          <main className="collection-main">
            <div className="collection-topbar"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={openSidebar}><Menu size={21} /></button><span>My workspace</span><span className="collection-topbar-right"><span className="save-dot" /> Stored locally</span></div>
            <TagManager tree={tagTree} noteCount={workspace.notes.length} onFilter={(tag) => { setActiveTag(tag); setQuery(''); setView('notes'); setMobileEditor(false); }} onPreview={workspace.previewTagChange} onApply={workspace.applyTagChange} />
          </main>}
      </div>
      <footer className="shell-statusbar"><span><span className="status-orb" /> {cloudSync.enabled ? cloudSync.snapshot.status === 'pending' ? 'Changes pending' : cloudSync.snapshot.status === 'error' ? 'Sync error' : cloudSync.snapshot.status === 'offline' ? 'Offline' : cloudSync.snapshot.status === 'syncing' ? 'Syncing' : 'Synced' : online ? offlineReady ? 'Ready offline' : 'Local workspace' : 'Working offline'}</span><span>{workspace.notes.length} {workspace.notes.length === 1 ? 'note' : 'notes'} · Markdown · Noor Note</span></footer>
      <MobileBottomNavigation view={view} onNavigate={(next) => next === 'graph' ? showGraph('global') : switchView(next)} onSearch={focusSearch} />
      <TemplatePicker action={templateAction} initialId={templateInitialId} workspace={workspace} note={workspace.selectedNote} selection={templateSelection} onInsert={(text) => editorPaneRef.current?.insertText(text)} onCreated={selectNote} onClose={() => setTemplateAction(null)} onSettings={openTemplateSettings} />
      <NoteComposer action={composerAction} source={workspace.selectedNote} selection={composerSelection} workspace={workspace} onClose={() => setComposerAction(null)} onOpenNote={selectNote} onOpenCanvas={(id) => { setCanvasTabs((current) => ({ ids: current.ids.includes(id) ? current.ids : [...current.ids, id], activeId: id })); setView('canvas'); setLayoutRestoreKey((value) => value + 1); }} />
      {historyNoteId && workspace.repository && <VersionHistory key={historyNoteId} noteId={historyNoteId} repository={workspace.repository} flushPending={workspace.flushPending} onClose={() => setHistoryNoteId(null)} onRestored={async (note) => { await workspace.refreshActive(); await workspace.selectNote(note.id); setNoteSnapshots((current) => new Map(current).set(note.id, note)); }} onDuplicated={async (note) => { await workspace.refreshActive(); selectNote(note.id); }} />}
      {aiAction && workspace.selectedNote && <AiNoteActions key={`${workspace.selectedNote.id}:${aiAction}`} action={aiAction} source={workspace.selectedNote} selection={aiSelection} onClose={() => setAiAction(null)} onApplyEdit={(source: NoteActionSource, edit) => workspace.selectedNote?.id === source.id && workspace.selectedNote.markdown === source.markdown && Boolean(editorPaneRef.current?.replaceRange(source.markdown, edit))} onApplyTitle={(source: NoteActionSource, title) => { if (workspace.selectedNote?.id !== source.id || workspace.selectedNote.markdown !== source.markdown || workspace.selectedNote.title !== source.title) return false; workspace.patchNote(source.id, { title }); return true; }} onUndoEdit={(id, expectedMarkdown) => workspace.selectedNote?.id === id && workspace.selectedNote.markdown === expectedMarkdown && Boolean(editorPaneRef.current?.undoIfCurrent(expectedMarkdown))} onUndoTitle={(id, expectedTitle, previousTitle) => { if (workspace.selectedNote?.id !== id || workspace.selectedNote.title !== expectedTitle) return false; workspace.patchNote(id, { title: previousTitle }); return true; }} />}
      {audioRecorderOpen && <AudioRecorder workspace={workspace} initialNoteId={workspace.selectedNote?.id ?? null} onClose={() => setAudioRecorderOpen(false)} onOpenNote={selectNote} onOpenTranscript={(id) => setTranscriptTarget({ id, timeMs: 0 })} />}
      {pdfTarget && <PdfReader key={`${pdfTarget.id}:${pdfTarget.page}:${pdfTarget.annotationId ?? ''}`} workspace={workspace} attachmentId={pdfTarget.id} initialPage={pdfTarget.page} initialAnnotationId={pdfTarget.annotationId} onClose={() => setPdfTarget(null)} onOpenNote={(id, line) => { setPdfTarget(null); selectNote(id, undefined, undefined, line); }} onOpenOcr={(id, page) => setOcrTarget({ id, page })} />}
      {ocrTarget && <OcrPanel key={`${ocrTarget.id ?? 'upload'}:${ocrTarget.page}`} workspace={workspace} initialAttachmentId={ocrTarget.id} initialPage={ocrTarget.page} onClose={() => setOcrTarget(null)} onSaved={() => { workspace.invalidateOcrSearch(); setOcrRevision((value) => value + 1); }} />}
      {transcriptTarget && <TranscriptPanel key={`${transcriptTarget.id ?? 'upload'}:${transcriptTarget.timeMs}`} workspace={workspace} initialAttachmentId={transcriptTarget.id} initialTimeMs={transcriptTarget.timeMs} onClose={() => { setTranscriptTarget(null); if (window.location.hash.startsWith('#noor-transcript=')) history.replaceState(null, '', window.location.pathname + window.location.search); }} onSaved={() => { workspace.invalidateDerivedSearch(); setOcrRevision((value) => value + 1); }} onOpenNote={selectNote} />}
      </div>
      <CommandSurface open={commandOpen} onOpenChange={setCommandOpen} commands={commands} title="Noor Note commands" />
      <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} notes={workspace.notes} folders={workspace.folders} recentIds={recentNoteIds} onOpenNote={openQuickNote} onOpenFolder={(id) => { workspace.setSelectedFolderId(id); setFocusFolder({ id, token: crypto.randomUUID() }); setView('notes'); setMobileEditor(false); setSidebarOpen(true); }} onCreate={createQuickNote} />
      <WorkspaceManager open={workspaceManagerOpen} onOpenChange={setWorkspaceManagerOpen} workspaces={savedWorkspaces} activeId={activeSavedWorkspaceId} startupId={startupWorkspaceId} error={workspaceManagerError} widths={sidebarWidths} onWidthsChange={(widths) => setSidebarWidths((current) => ({ ...current, ...widths }))} onCreate={createSavedWorkspace} onUpdate={updateSavedWorkspace} onLoad={loadSavedWorkspace} onDuplicate={duplicateSavedWorkspace} onRename={renameSavedWorkspace} onDelete={deleteSavedWorkspace} onStartup={setStartupWorkspace} />
      <BookmarkManager open={bookmarkManagerOpen} onOpenChange={setBookmarkManagerOpen} bookmarks={bookmarks} notes={workspace.notes} bases={bookmarkLoadedVaultId === activeVaultId ? bookmarkBases : []} canvases={bookmarkLoadedVaultId === activeVaultId ? bookmarkCanvases : []} recentNoteIds={recentNoteIds} recentSearches={searchHistory.recent} closedTabs={editorSession.closedTabs} error={bookmarkError} onCreate={createBookmark} onUpdate={updateBookmark} onRemove={removeBookmark} onOpen={openBookmark} onToggleNoteFlag={toggleNoteFlag} onOpenNote={(id) => { selectNote(id); setBookmarkManagerOpen(false); }} onOpenSearch={(value) => { setQuery(value); setActiveTag(null); setView('notes'); setMobileEditor(false); setBookmarkManagerOpen(false); if (workspace.activeVault) setSearchHistory(addRecentSearch(workspace.activeVault.id, value)); }} onRestoreClosed={(index) => { void restoreClosedTab(index); setBookmarkManagerOpen(false); }} />
      {workspace.error && <div className="toast error-toast" role="alert"><span>{workspace.error}</span><button type="button" aria-label="Dismiss error" onClick={workspace.clearError}><X size={17} /></button></div>}
      {!workspace.error && workspace.quotaWarning && <div className="toast error-toast" role="alert"><span>Browser storage is nearly full. Export your vault ZIP soon.</span><button type="button" aria-label="Dismiss storage warning" onClick={workspace.clearQuotaWarning}><X size={17} /></button></div>}
      {!workspace.error && !workspace.quotaWarning && workspace.recoveredDraft && <div className="toast success-toast" role="status"><Check size={17} /><span>Recovered your latest local draft.</span><button type="button" aria-label="Dismiss draft recovery notice" onClick={workspace.clearRecoveredDraft}><X size={17} /></button></div>}
      {importCount !== null && <div className="toast success-toast" role="status"><Check size={17} /><span>Imported {importCount} {importCount === 1 ? 'item' : 'items'}.</span><button type="button" aria-label="Dismiss import confirmation" onClick={() => setImportCount(null)}><X size={17} /></button></div>}
    </div>
  );
}

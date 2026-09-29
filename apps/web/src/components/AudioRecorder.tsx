'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@noor-note/ui';
import { joinVaultPath, planAttachmentLinkRename, type Attachment, type AttachmentLinkChange, type VaultNote } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { recordingFileName, recordingLink } from '../lib/audio-recording';
import styles from './AudioRecorder.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; onClose: () => void; initialNoteId: string | null; onOpenNote: (id: string) => void; onOpenTranscript: (id: string) => void }
function displayTime(ms: number): string { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export function AudioRecorder({ workspace, onClose, initialNoteId, onOpenNote, onOpenTranscript }: Props) {
  const recording = useAudioRecorder();
  const [name, setName] = useState(() => `Voice note ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}`);
  const [targetNoteId, setTargetNoteId] = useState(initialNoteId ?? '');
  const [selectedId, setSelectedId] = useState('');
  const [justSaved, setJustSaved] = useState<Attachment | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [renamePreview, setRenamePreview] = useState<{ name: string; path: string; updatedAt: string; changes: AttachmentLinkChange[]; expectedRevisions: { id: string; revision: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = useMemo(() => {
    const all = workspace.attachments.filter((item) => item.recording);
    if (justSaved && !all.some((item) => item.id === justSaved.id)) all.unshift(justSaved);
    return all.sort((a, b) => (b.recording?.recordedAt ?? '').localeCompare(a.recording?.recordedAt ?? ''));
  }, [workspace.attachments, justSaved]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId || !workspace.repository) return;
    let live = true;
    let url: string | null = null;
    void workspace.repository.getAttachmentBlob(selectedId).then((blob) => {
      if (!blob || !live) return;
      url = URL.createObjectURL(blob);
      setSavedUrl(url);
    }).catch(() => { if (live) setError('Could not load this recording.'); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); setSavedUrl(null); };
  }, [selectedId, workspace.repository]);
  const choose = (item: Attachment) => { setSelectedId(item.id); setRename(item.name.replace(/\.[^.]+$/u, '')); setRenamePreview(null); setMessage(null); setError(null); };
  const close = (): boolean => {
    if ((recording.status === 'requesting' || recording.status === 'recording' || recording.status === 'paused' || recording.status === 'stopping' || recording.draft) && !window.confirm('Discard the unsaved recording?')) return false;
    onClose(); return true;
  };
  const save = async () => {
    const draft = recording.draft, vault = workspace.activeVault, repository = workspace.repository;
    if (!draft || !vault || !repository) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const filename = recordingFileName(name, draft.mime);
      await workspace.flushPending();
      const note = targetNoteId ? workspace.notes.find((item) => item.id === targetNoteId) : null;
      const attachment = await repository.addAttachment(vault.id, note?.folderId ?? workspace.selectedFolderId, draft.blob, filename, { recordedAt: draft.recordedAt, durationMs: draft.durationMs });
      await workspace.refreshActive();
      setJustSaved(attachment); choose(attachment); recording.discard();
      setMessage('Recording saved locally. Select a note below to attach it.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the recording.'); }
    finally { setBusy(false); }
  };
  const renameSelected = async () => {
    if (!selected || !workspace.repository) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const filename = recordingFileName(rename, selected.mime);
      if (filename === selected.name) throw new Error('Enter a different recording name.');
      if (!renamePreview || renamePreview.name !== filename || renamePreview.path !== selected.path || renamePreview.updatedAt !== selected.updatedAt) {
        await workspace.flushPending();
        const entries = (await workspace.repository.listTree(selected.vaultId)).notes;
        const notes = (await Promise.all(entries.map((entry) => workspace.repository!.getNote(entry.id)))).filter((note): note is VaultNote => Boolean(note));
        const newPath = joinVaultPath(selected.path.slice(0, selected.path.lastIndexOf('/')) || '/', filename);
        setRenamePreview({ name: filename, path: selected.path, updatedAt: selected.updatedAt, changes: planAttachmentLinkRename(notes, selected.path, newPath), expectedRevisions: notes.map(({ id, revision }) => ({ id, revision })) });
        return;
      }
      const updated = await workspace.repository.renameAttachmentWithLinks(selected.id, filename, renamePreview.path, renamePreview.updatedAt, renamePreview.changes, renamePreview.expectedRevisions);
      setJustSaved(updated); setRenamePreview(null); await workspace.refreshActive();
      if (workspace.selectedNote?.id || targetNoteId) await workspace.selectNote(workspace.selectedNote?.id ?? targetNoteId);
      setMessage('Recording renamed and linked notes updated.');
    } catch (caught) { setRenamePreview(null); setError(caught instanceof Error ? caught.message : 'Could not rename the recording.'); }
    finally { setBusy(false); }
  };
  const attach = async () => {
    if (!selected || !targetNoteId || !workspace.repository) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await workspace.flushPending();
      const note = await workspace.repository.getNote(targetNoteId);
      if (!note || note.deletedAt || note.vaultId !== selected.vaultId) throw new Error('Choose an available note in this vault.');
      const link = recordingLink(note.path, selected);
      if (note.markdown.includes(link)) throw new Error('This recording is already linked in the selected note.');
      const markdown = `${note.markdown.trimEnd()}\n\n${link}\n`;
      await workspace.repository.saveNote(note.id, { markdown }, true);
      await workspace.refreshActive();
      await workspace.selectNote(note.id);
      setMessage(`Attached to ${note.title || 'Untitled note'}.`);
      onOpenNote(note.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not attach the recording.'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }} title="Voice notes" description="Record with your microphone, then save the audio in this vault." contentClassName={styles.dialog}>
    <div className={styles.content}>
      <div className={styles.controls} aria-label="Recording controls">
        <span className={styles.state} role="status">{recording.status === 'requesting' ? 'Requesting microphone access…' : recording.status === 'recording' ? 'Recording' : recording.status === 'paused' ? 'Paused' : recording.status === 'stopping' ? 'Finishing recording…' : recording.status === 'ready' ? 'Ready to save' : 'Microphone idle'} · {displayTime(recording.elapsedMs)}</span>
        <div className={styles.buttons}>
          {(recording.status === 'idle' || recording.status === 'error') && <button type="button" onClick={() => { void recording.start(); }}>Record</button>}
          {recording.status === 'recording' && <button type="button" onClick={recording.pause}>Pause</button>}
          {recording.status === 'paused' && <button type="button" onClick={recording.resume}>Resume</button>}
          {(recording.status === 'recording' || recording.status === 'paused') && <button type="button" onClick={recording.stop}>Stop</button>}
          {recording.status === 'ready' && <button type="button" onClick={() => { recording.discard(); setMessage(null); }}>Discard draft</button>}
        </div>
      </div>
      {recording.error && <p role="alert" className={styles.error}>{recording.error}</p>}
      {recording.draft && <section className={styles.section} aria-label="Unsaved recording">
        <h3>Unsaved recording</h3>
        <audio controls preload="metadata" src={recording.draft.url} aria-label="Playback unsaved recording" />
        <label>Recording name<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => { void save(); }}>{busy ? 'Saving…' : 'Save recording'}</button>
      </section>}
      <section className={styles.section} aria-label="Saved recordings">
        <h3>Saved recordings</h3>
        {items.length ? <><label>Recording<select value={selectedId} onChange={(event) => { const item = items.find((entry) => entry.id === event.target.value); if (item) choose(item); }}><option value="">Choose a recording</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {displayTime(item.recording?.durationMs ?? 0)}</option>)}</select></label>
          {selected && <><p className={styles.meta}>{selected.path} · {selected.recording ? new Date(selected.recording.recordedAt).toLocaleString() : ''}</p>{savedUrl ? <audio controls preload="none" src={savedUrl} aria-label={`Playback ${selected.name}`} /> : <p>Loading audio…</p>}
            <button type="button" disabled={busy} onClick={() => { if (close()) onOpenTranscript(selected.id); }}>Transcribe recording</button>
            <div className={styles.rename}><label>Rename recording<input value={rename} maxLength={180} onChange={(event) => { setRename(event.target.value); setRenamePreview(null); }} /></label><button type="button" disabled={busy} onClick={() => { void renameSelected(); }}>{renamePreview ? 'Apply rename' : 'Preview rename'}</button></div>
            {renamePreview && <div className={styles.renamePreview} aria-label="Recording rename preview"><strong>Rename to {renamePreview.name}</strong><p>{renamePreview.changes.length} linked {renamePreview.changes.length === 1 ? 'note' : 'notes'} will be updated.</p>{renamePreview.changes.map((change) => <details key={change.noteId}><summary>{change.path} · {change.count} {change.count === 1 ? 'link' : 'links'}</summary><div className={styles.diff}><pre>{change.before}</pre><pre>{change.after}</pre></div></details>)}</div>}
            {workspace.notes.length > 0 && <div className={styles.attach}><label>Attach to note<select value={targetNoteId} onChange={(event) => setTargetNoteId(event.target.value)}><option value="">Choose a note</option>{workspace.notes.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select></label><button type="button" disabled={busy || !targetNoteId} onClick={() => { void attach(); }}>Attach to note</button></div>}
          </>}
        </> : <p className={styles.meta}>No recordings in this vault yet.</p>}
      </section>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      <div className={styles.footer}><button type="button" onClick={close}>Close</button></div>
    </div>
  </Dialog>;
}

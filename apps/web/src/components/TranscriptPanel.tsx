'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@noor-note/ui';
import type { Attachment, TranscriptSegment } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { BrowserWhisperProvider, type TranscriptionProvider } from '../lib/transcription-provider';
import { isTranscribable, TranscriptStore, type TranscriptDraft } from '../lib/transcript-store';
import { recordingLink } from '../lib/audio-recording';
import styles from './TranscriptPanel.module.css';

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>;
  initialAttachmentId?: string | null;
  initialTimeMs?: number;
  provider?: TranscriptionProvider;
  onClose: () => void;
  onSaved: () => void;
  onOpenNote: (id: string) => void;
}

const browserProvider = new BrowserWhisperProvider();
function clock(ms: number): string { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function deepLink(attachmentId: string, timeMs: number): string {
  const url = new URL(window.location.href);
  url.hash = `noor-transcript=${attachmentId}&t=${Math.max(0, Math.round(timeMs))}`;
  return url.toString();
}

export function TranscriptPanel({ workspace, initialAttachmentId = null, initialTimeMs = 0, provider = browserProvider, onClose, onSaved, onOpenNote }: Props) {
  const [attachmentId, setAttachmentId] = useState<string | null>(initialAttachmentId);
  const [uploaded, setUploaded] = useState<Attachment | null>(null);
  const [source, setSource] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranscriptDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const media = useRef<HTMLAudioElement | HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const seekOnLoad = useRef(initialTimeMs);
  const attachment = workspace.attachments.find((item) => item.id === attachmentId) ?? (uploaded?.id === attachmentId ? uploaded : null);
  const store = useMemo(() => workspace.repository && workspace.activeVault ? new TranscriptStore(workspace.repository, workspace.activeVault.id) : null, [workspace.repository, workspace.activeVault]);
  const selectedSegments = draft?.segments.filter((segment) => selected.has(segment.id)) ?? [];

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!attachmentId || !workspace.repository) return;
    let live = true; let url: string | null = null;
    void Promise.all([workspace.repository.getAttachmentBlob(attachmentId), store?.get(attachmentId)]).then(([blob, transcript]) => {
      if (!live) return;
      if (!blob) throw new Error('The original audio or video file is missing.');
      url = URL.createObjectURL(blob); setSource(blob); setSourceUrl(url);
      setDraft(transcript ? { providerId: transcript.providerId, language: transcript.language, segments: transcript.segments } : null);
      setSavedAt(transcript?.updatedAt ?? null);
      setSelected(new Set());
    }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not open this media file.'); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [attachmentId, workspace.repository, store]);

  const upload = async (file: File) => {
    if (!isTranscribable({ name: file.name, mime: file.type })) { setError('Choose an audio or video file.'); return; }
    setBusy(true); setError(null);
    try {
      const added = await workspace.addAttachment(workspace.selectedFolderId, file);
      if (!added) throw new Error('Could not save the original media file.');
      setUploaded(added); setAttachmentId(added.id); setMessage('Original media saved locally.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not upload media.'); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!source || !attachment || busy) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setRunning(true); setError(null); setMessage(null); setProgress('Preparing audio');
    try {
      const result = await provider.transcribe(source, setProgress, controller.signal);
      if (controller.signal.aborted) return;
      setDraft(result); setSelected(new Set()); setMessage('Transcript ready. Review and save the segments.');
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Transcription failed. The original file is unchanged.'); }
    finally { if (abort.current === controller) abort.current = null; setBusy(false); setRunning(false); setProgress(null); }
  };
  const save = async () => {
    if (!store || !attachmentId || !draft || busy) return;
    setBusy(true); setError(null);
    try {
      const record = await store.save(attachmentId, draft, savedAt);
      setSavedAt(record.updatedAt); onSaved(); setMessage('Transcript saved locally and indexed for search.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save transcript.'); }
    finally { setBusy(false); }
  };
  const edit = (id: string, patch: Partial<TranscriptSegment>) => setDraft((current) => current ? { ...current, segments: current.segments.map((segment) => segment.id === id ? { ...segment, ...patch } : segment) } : current);
  const selectedText = selectedSegments.map((segment) => segment.text.trim()).filter(Boolean).join(' ');
  const create = async (kind: 'note' | 'task' | 'quote') => {
    if (!selectedText || !attachment || !workspace.repository || !workspace.activeVault || busy) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      const quote = selectedSegments.map((segment) => `> ${segment.text.trim()}`).join('\n');
      const markdownFor = (notePath: string) => {
        const source = recordingLink(notePath, attachment).replace(/\)$/u, `#t=${(selectedSegments[0]!.startMs / 1000).toFixed(3)})`);
        const body = kind === 'task' ? `- [ ] ${selectedText}` : kind === 'quote' ? quote : selectedText;
        return `${body}\n\nSource at ${clock(selectedSegments[0]!.startMs)}: ${source}\n`;
      };
      const active = workspace.selectedNote;
      if (kind === 'quote' && active) {
        const fresh = await workspace.repository.getNote(active.id);
        if (!fresh) throw new Error('The active note is unavailable.');
        const updated = await workspace.repository.saveNote(fresh.id, { markdown: `${fresh.markdown.trimEnd()}\n\n${markdownFor(fresh.path)}` }, true);
        await workspace.refreshActive(); onOpenNote(updated.id);
      } else {
        const title = `${kind === 'task' ? 'Task' : 'Transcript'} from ${attachment.name} ${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}`;
        const note = await workspace.repository.createNote(workspace.activeVault.id, attachment.folderId, title, markdownFor);
        await workspace.refreshActive(); onOpenNote(note.id);
      }
      setMessage(`${kind === 'task' ? 'Task' : kind === 'quote' ? 'Quote' : 'Note'} created from selected transcript.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create content from transcript.'); }
    finally { setBusy(false); }
  };
  const copyLink = async () => {
    if (!attachment || !selectedSegments.length) return;
    try { await navigator.clipboard.writeText(deepLink(attachment.id, selectedSegments[0]!.startMs)); setMessage('Timestamp link copied.'); }
    catch { setError('Could not copy the timestamp link.'); }
  };
  const seek = (timeMs: number) => { if (media.current) { media.current.currentTime = timeMs / 1000; void media.current.play().catch(() => undefined); } };

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title="Transcription" description="Transcribe and review audio or video in this vault." contentClassName={styles.dialog}>
    <div className={styles.content}>
      <div className={styles.source}>
        <label>Upload audio or video<input type="file" accept="audio/*,video/*" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
        {attachment && <><strong>{attachment.name}</strong>{sourceUrl && (attachment.mime.startsWith('video/') ? <video ref={media as React.RefObject<HTMLVideoElement>} controls preload="metadata" src={sourceUrl} onLoadedMetadata={() => { if (media.current && seekOnLoad.current) { media.current.currentTime = seekOnLoad.current / 1000; seekOnLoad.current = 0; } }} aria-label={`Playback ${attachment.name}`} /> : <audio ref={media as React.RefObject<HTMLAudioElement>} controls preload="metadata" src={sourceUrl} onLoadedMetadata={() => { if (media.current && seekOnLoad.current) { media.current.currentTime = seekOnLoad.current / 1000; seekOnLoad.current = 0; } }} aria-label={`Playback ${attachment.name}`} />)}</>}
        <p>Speech recognition runs on this device. The first run downloads a speech model; source media is not uploaded to the model host.</p>
        <button type="button" disabled={!source || busy} onClick={() => void run()}>Transcribe with {provider.name}</button>
        {running && <button type="button" onClick={() => abort.current?.abort()}>Cancel transcription</button>}
        {progress && <p role="status">{progress}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status">{message}</p>}
      </div>
      {draft && <section className={styles.transcript} aria-label="Transcript segments">
        <header><h3>Transcript</h3><span>{draft.segments.length} segments</span></header>
        <p>Select segments to make a note, task, quote, or timestamp link. Edit text and speaker labels before saving.</p>
        <div className={styles.segments}>{draft.segments.map((segment) => <div className={styles.segment} key={segment.id}>
          <label className={styles.choose}><input type="checkbox" checked={selected.has(segment.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(segment.id); else next.delete(segment.id); return next; })} aria-label={`Select segment at ${clock(segment.startMs)}`} /></label>
          <button type="button" className={styles.time} onClick={() => seek(segment.startMs)} aria-label={`Play from ${clock(segment.startMs)}`}>{clock(segment.startMs)}</button>
          <div className={styles.segmentBody}><label>Speaker<input value={segment.speaker ?? ''} placeholder="Unknown" maxLength={100} onChange={(event) => edit(segment.id, { speaker: event.target.value.trim() || null })} /></label><label>Text<textarea value={segment.text} maxLength={20_000} onChange={(event) => edit(segment.id, { text: event.target.value })} /></label></div>
        </div>)}</div>
        <div className={styles.actions}><button type="button" disabled={!selectedText || busy} onClick={() => void create('note')}>Create note</button><button type="button" disabled={!selectedText || busy} onClick={() => void create('task')}>Create task</button><button type="button" disabled={!selectedText || busy} onClick={() => void create('quote')}>Create quote</button><button type="button" disabled={!selectedSegments.length || busy} onClick={() => void copyLink()}>Copy time link</button></div>
        <button type="button" className={styles.save} disabled={busy} onClick={() => void save()}>Save transcript</button>
      </section>}
    </div>
  </Dialog>;
}

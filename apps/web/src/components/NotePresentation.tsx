'use client';

import { parsePresentation, type Attachment, type VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { DialogContent, DialogRoot, DialogTitle } from '@noor-note/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownReadingView } from './MarkdownReadingView';
import styles from './NotePresentation.module.css';

interface Props {
  note: VaultNote;
  notes: NoteEntry[];
  attachments: Attachment[];
  repository: VaultRepository | null;
  onClose: () => void;
  onOpenNote: (id: string, fragment?: string) => void;
  onOpenPdf?: (id: string, page: number, annotationId: string | null) => void;
}

export function NotePresentation({ note, notes, attachments, repository, onClose, onOpenNote, onOpenPdf }: Props) {
  const slides = useMemo(() => parsePresentation(note.markdown), [note.markdown]);
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (document.fullscreenElement === rootRef.current) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
      else if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
      else setFullscreenError('Fullscreen is unavailable in this browser.');
    } catch {
      setFullscreenError('Could not enter fullscreen. The presentation remains open here.');
    }
  };

  useEffect(() => {
    const root = rootRef.current;
    const changed = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const onControl = target instanceof HTMLElement && Boolean(target.closest('button,a,summary'));
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ' && !onControl) {
        event.preventDefault(); setIndex((current) => Math.min(slides.length - 1, current + 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault(); setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Home') {
        event.preventDefault(); setIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault(); setIndex(slides.length - 1);
      } else if (event.key.toLowerCase() === 'n' && !onControl) {
        event.preventDefault(); setShowNotes((current) => !current);
      } else if (event.key.toLowerCase() === 'f' && !onControl) {
        event.preventDefault(); void toggleFullscreen();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const slide = slides[Math.min(index, slides.length - 1)]!;
  const notesVisible = showNotes && !fullscreen;
  return <DialogRoot open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent ref={rootRef} className={styles.presentation} aria-describedby={undefined}>
      <header className={styles.toolbar}>
        <DialogTitle className={styles.title}>{note.title || 'Untitled note'}</DialogTitle>
        <span className={styles.counter} aria-live="polite">Slide {index + 1} of {slides.length}</span>
        <button type="button" onClick={() => setShowNotes((current) => !current)} aria-pressed={showNotes} title={fullscreen ? 'Speaker notes are hidden in fullscreen' : undefined}>{showNotes ? 'Hide notes' : 'Speaker notes'}</button>
        <button type="button" onClick={() => { void toggleFullscreen(); }}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
        <button type="button" onClick={close}>Exit presentation</button>
      </header>
      <div className={`${styles.body} ${notesVisible ? styles.withNotes : ''}`}>
        <section className={styles.stage} aria-label={`Slide ${index + 1}`}>
          <div className={styles.slide} key={index}>
            {slide.markdown ? <MarkdownReadingView note={{ ...note, markdown: slide.markdown }} notes={notes} attachments={attachments} repository={repository} instanceId={`presentation-${note.id}-${index}`} onOpenNote={(id, fragment) => { close(); onOpenNote(id, fragment); }} onOpenPdf={onOpenPdf ? (id, page, annotationId) => { close(); onOpenPdf(id, page, annotationId); } : undefined} /> : <p className={styles.empty}>This slide is empty.</p>}
          </div>
        </section>
        {notesVisible && <aside className={styles.notes} aria-label="Speaker notes"><h2>Speaker notes</h2>{slide.speakerNotes ? <pre>{slide.speakerNotes}</pre> : <p>No notes for this slide.</p>}</aside>}
      </div>
      <footer className={styles.footer}>
        <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>Previous</button>
        <progress aria-label="Presentation progress" value={index + 1} max={slides.length} />
        <button type="button" onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))} disabled={index === slides.length - 1}>Next</button>
      </footer>
      {fullscreenError && <p role="alert" className={styles.error}>{fullscreenError}</p>}
      <p className={styles.hint}>← → navigate · Home / End jump · N notes · F fullscreen · Esc exit</p>
    </DialogContent>
  </DialogRoot>;
}

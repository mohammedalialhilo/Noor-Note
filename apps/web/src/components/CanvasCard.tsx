'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileAudio, FileImage, FileText, FileVideo, Link2, Paperclip, PanelsTopLeft } from 'lucide-react';
import type { Attachment, CanvasNode } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { previewImageTypes, safeAttachmentPreview } from '../lib/safe-attachment-preview';
import styles from './CanvasView.module.css';

interface Props { node: CanvasNode; notes: NoteEntry[]; attachments: Attachment[]; repository: VaultRepository | null; onOpenNote: (id: string) => void }

function AttachmentPreview({ node, attachment, repository }: { node: CanvasNode; attachment: Attachment | undefined; repository: VaultRepository | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!attachment || !repository) return;
    let alive = true, objectUrl: string | null = null;
    const previewKind = node.kind === 'attachment'
      ? previewImageTypes.has(attachment.mime) ? 'image' : attachment.mime === 'application/pdf' ? 'pdf' : 'attachment'
      : node.kind;
    void repository.getAttachmentBlob(attachment.id).then(async (blob) => {
      if (!blob) { if (alive) setError(true); return; }
      const display = previewKind === 'image' || previewKind === 'pdf'
        ? await safeAttachmentPreview(blob, previewKind === 'pdf' ? 'application/pdf' : attachment.mime)
        : blob;
      if (!alive) return;
      if (!display) { setError(true); return; }
      objectUrl = URL.createObjectURL(display);
      setUrl(objectUrl);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, node.kind, repository]);
  if (!attachment) return <div className={styles.cardMissing}>Attachment unavailable: {node.filePath ?? 'unknown file'}</div>;
  if (error) return <div className={styles.cardMissing}>Could not load {attachment.name}.</div>;
  const kind = node.kind === 'attachment' ? previewImageTypes.has(attachment.mime) ? 'image' : attachment.mime === 'application/pdf' ? 'pdf' : attachment.mime.startsWith('audio/') ? 'audio' : attachment.mime.startsWith('video/') ? 'video' : 'attachment' : node.kind;
  if (!url) return <div className={styles.cardMissing}>Loading {attachment.name}…</div>;
  if (kind === 'image') return <Image className={styles.mediaImage} unoptimized src={url} width={640} height={480} alt={attachment.name} />;
  if (kind === 'pdf') return <iframe className={styles.mediaFrame} title={attachment.name} src={url} sandbox="" referrerPolicy="no-referrer" />;
  if (kind === 'audio') return <audio className={styles.mediaPlayer} src={url} controls preload="none" aria-label={attachment.name} />;
  if (kind === 'video') return <video className={styles.mediaPlayer} src={url} controls preload="none" aria-label={attachment.name} />;
  return <button type="button" className={styles.attachmentDownload} onClick={() => {
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
  }}><Paperclip size={16} /> Download {attachment.name}</button>;
}

export function CanvasCardContent({ node, notes, attachments, repository, onOpenNote }: Props) {
  if (node.kind === 'group' || node.kind === 'frame') return <div className={styles.containerLabel}><PanelsTopLeft size={16} />{node.label || (node.kind === 'frame' ? 'Frame' : 'Group')}</div>;
  if (node.kind === 'text') return <div className={styles.textMarkdown}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{node.text || '*Double-click to edit text*'}</ReactMarkdown></div>;
  if (node.kind === 'note') {
    const note = notes.find((item) => item.id === node.noteId);
    return note ? <div className={styles.noteCard}><div className={styles.cardType}><FileText size={15} /> NOTE</div><strong>{note.title || 'Untitled note'}</strong><p>{note.excerpt || note.path}</p><button type="button" onClick={() => onOpenNote(note.id)}>Open note</button></div> : <div className={styles.cardMissing}>Linked note is unavailable.</div>;
  }
  if (node.kind === 'url') return node.url ? <div className={styles.urlCard}><Link2 size={18} /><strong>{node.label || new URL(node.url).hostname}</strong><a href={node.url} target="_blank" rel="noopener noreferrer">Open website</a><small>{node.url}</small></div> : <div className={styles.cardMissing}>Set a URL in the inspector.</div>;
  const attachment = attachments.find((item) => item.id === node.attachmentId);
  return <div className={styles.fileCard}><div className={styles.cardType}>{node.kind === 'image' ? <FileImage size={15} /> : node.kind === 'audio' ? <FileAudio size={15} /> : node.kind === 'video' ? <FileVideo size={15} /> : <Paperclip size={15} />}{attachment?.name ?? node.label ?? 'FILE'}</div><AttachmentPreview node={node} attachment={attachment} repository={repository} /></div>;
}

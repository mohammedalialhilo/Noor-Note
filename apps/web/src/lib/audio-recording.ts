import { safeFileStem, type Attachment } from '@noor-note/core';

const formats = [
  'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg',
] as const;

/** MediaRecorder chooses the actual encoding; this list only expresses preference. */
export function preferredAudioMime(isSupported: (mime: string) => boolean): string | undefined {
  return formats.find((format) => isSupported(format));
}

export function audioExtension(mime: string): string {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase();
  if (base === 'audio/webm') return 'webm';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/wav' || base === 'audio/wave') return 'wav';
  throw new Error('This browser produced an unknown audio format. The recording cannot be saved safely.');
}

export function recordingFileName(title: string, mime: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 180) throw new Error('Enter a recording name up to 180 characters.');
  const stem = safeFileStem(trimmed);
  if (!stem) throw new Error('Enter a valid recording name.');
  return `${stem}.${audioExtension(mime)}`;
}

export function recordingLink(notePath: string, attachment: Pick<Attachment, 'path' | 'name'>): string {
  const from = notePath.split('/').slice(1, -1);
  const to = attachment.path.split('/').slice(1);
  while (from.length && to.length && from[0]!.toLocaleLowerCase() === to[0]!.toLocaleLowerCase()) { from.shift(); to.shift(); }
  const path = [...from.map(() => '..'), ...to].map((part) => encodeURIComponent(part).replace(/\(/gu, '%28').replace(/\)/gu, '%29')).join('/');
  const label = attachment.name.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
  return `[${label}](${path})`;
}

export function recordingError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access was denied. Allow it in your browser settings and try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect one and try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy or unavailable. Close other apps using it and try again.';
  return error instanceof Error ? error.message : 'Could not record audio.';
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { preferredAudioMime, recordingError } from '../lib/audio-recording';

type Status = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'ready' | 'error';
export interface RecordingDraft { blob: Blob; mime: string; durationMs: number; recordedAt: string; url: string }

/** Owns microphone and MediaRecorder lifecycle. Consumers persist only a finished draft. */
export function useAudioRecorder() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecordingDraft | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const failedRef = useRef(false);
  const liveRef = useRef(true);

  const releaseStream = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  const clearDraft = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setDraft(null); };
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      const recorder = recorderRef.current;
      if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; if (recorder.state !== 'inactive') recorder.stop(); }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);
  useEffect(() => {
    if (status !== 'recording') return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAtRef.current - pausedMsRef.current));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [status]);

  const start = async () => {
    if (status === 'recording' || status === 'paused' || status === 'requesting' || status === 'stopping') return;
    setError(null); clearDraft(); setElapsedMs(0); setStatus('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is unavailable in this browser or context. Use a supported browser over HTTPS or localhost.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!liveRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const mime = preferredAudioMime((value) => MediaRecorder.isTypeSupported?.(value) ?? false);
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now(); pausedAtRef.current = 0; pausedMsRef.current = 0; failedRef.current = false;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = (event) => {
        failedRef.current = true;
        releaseStream();
        if (liveRef.current) { setError(recordingError(event)); setStatus('error'); }
      };
      recorder.onstop = () => {
        releaseStream();
        if (!liveRef.current || failedRef.current) return;
        const finishedAt = pausedAtRef.current || Date.now();
        const durationMs = Math.max(0, finishedAt - startedAtRef.current - pausedMsRef.current);
        const type = recorder.mimeType || mime || chunksRef.current[0]?.type || '';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (!blob.size) { setError('The microphone did not capture any audio. Try recording again.'); setStatus('error'); return; }
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setElapsedMs(durationMs);
        setDraft({ blob, mime: type, durationMs, recordedAt: new Date(startedAtRef.current).toISOString(), url });
        setStatus('ready');
      };
      recorder.start(1000);
      setStatus('recording');
    } catch (caught) { releaseStream(); if (liveRef.current) { setError(recordingError(caught)); setStatus('error'); } }
  };
  const pause = () => {
    if (recorderRef.current?.state !== 'recording') return;
    recorderRef.current.pause(); pausedAtRef.current = Date.now(); setElapsedMs(pausedAtRef.current - startedAtRef.current - pausedMsRef.current); setStatus('paused');
  };
  const resume = () => {
    if (recorderRef.current?.state !== 'paused') return;
    pausedMsRef.current += Date.now() - pausedAtRef.current; pausedAtRef.current = 0;
    recorderRef.current.resume(); setStatus('recording');
  };
  const stop = () => {
    if (!recorderRef.current || !['recording', 'paused'].includes(recorderRef.current.state)) return;
    setStatus('stopping'); recorderRef.current.stop();
  };
  const discard = () => { clearDraft(); setElapsedMs(0); setError(null); setStatus('idle'); };
  return { status, error, draft, elapsedMs, start, pause, resume, stop, discard };
}

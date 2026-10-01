'use client';

import type { VaultNote } from '@noor-note/core';
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../auth/AuthProvider';
import { CollabStore } from '../lib/collab-store';
import { SupabaseCollabTransport } from '../lib/collab-transport';
import { CollaborationSession, type CollabConnectionState, type CollabPeer, type CollabTransport } from '../lib/collaboration';

export function useCollaborativeNote(note: VaultNote, networkEnabled: boolean, onMarkdown: (markdown: string) => void) {
  const { client, user } = useAccount();
  const userId = user?.id;
  const userName = user?.email ?? 'Collaborator';
  const callbackRef = useRef(onMarkdown);
  useEffect(() => { callbackRef.current = onMarkdown; }, [onMarkdown]);
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [state, setState] = useState<CollabConnectionState>('connecting');
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!note.collaborative || !client || !userId) return;
    const store = new CollabStore();
    const transport: CollabTransport = networkEnabled ? new SupabaseCollabTransport(client, note.vaultId, userId, userName) : {
      async fetch() { throw new Error('Enable sync once to cache this collaborative note before editing offline'); },
      async append() { throw new Error('Cloud sync is paused'); },
      async connect(_noteId, callbacks) { callbacks.status('offline'); return () => undefined; },
      async sendAwareness() { /* Presence is disabled while sync is paused. */ },
    };
    let active = true;
    const current = new CollaborationSession(note.id, store, transport, { name: userName },
      (markdown) => { if (active) callbackRef.current(markdown); },
      (next, people) => { if (active) { setState(next); setPeers(people); } });
    void current.start().then(() => { if (active) setSession(current); else void current.stop(); }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not open the collaborative document');
      void current.stop();
    });
    const reconnect = () => { void current.reconnect(); void current.refresh(); };
    window.addEventListener('online', reconnect);
    const interval = window.setInterval(reconnect, 15_000);
    return () => { active = false; window.removeEventListener('online', reconnect); window.clearInterval(interval); setSession(null); setPeers([]); void current.stop().finally(() => store.close()); };
  }, [note.id, note.vaultId, note.collaborative, networkEnabled, client, userId, userName]);
  return { session, state, peers, error, available: Boolean(client && user) };
}

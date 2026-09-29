// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, type Attachment } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '../src/components/AudioRecorder';
import { useAudioRecorder } from '../src/hooks/useAudioRecorder';
import { audioExtension, preferredAudioMime, recordingFileName, recordingLink } from '../src/lib/audio-recording';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

class FakeMediaRecorder {
  static isTypeSupported = (mime: string) => mime === 'audio/webm;codecs=opus';
  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { this.mimeType = options?.mimeType ?? 'audio/webm'; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) } as BlobEvent); this.onstop?.(new Event('stop')); }
}

function setupMicrophone() {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:recording'), revokeObjectURL: vi.fn() });
  return { getUserMedia, stopTrack };
}

describe('audio recording', () => {
  it('selects a supported format and builds portable attachment links', () => {
    expect(preferredAudioMime((mime) => mime === 'audio/mp4')).toBe('audio/mp4');
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingFileName('Meeting', 'audio/mp4')).toBe('Meeting.m4a');
    expect(recordingLink('/Plans/Today.md', { name: 'Voice note.webm', path: '/Audio/Voice note.webm' })).toBe('[Voice note.webm](../Audio/Voice%20note.webm)');
    expect(() => recordingFileName('  ', 'audio/webm')).toThrow(/name/);
  });

  it('requests microphone only on record, handles pause/resume, and releases tracks after stop', async () => {
    const { getUserMedia, stopTrack } = setupMicrophone();
    let clock = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const { result, unmount } = renderHook(() => useAudioRecorder());
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => { await result.current.start(); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    clock += 1000; act(() => result.current.pause());
    expect(result.current.status).toBe('paused');
    clock += 2000; act(() => result.current.resume());
    clock += 500; act(() => result.current.stop());
    expect(result.current.status).toBe('ready');
    expect(result.current.draft).toMatchObject({ mime: 'audio/webm;codecs=opus', durationMs: 1500 });
    expect(stopTrack).toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recording');
  });

  it('shows a readable permission error and stops an active track when closed', async () => {
    const { getUserMedia, stopTrack } = setupMicrophone();
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    const { result, unmount } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Microphone access was denied/);
    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('recording');
    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('saves a recording with metadata and attaches its link to a note', async () => {
    setupMicrophone();
    const vaultId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Today', markdown: '# Today' });
    const attachment: Attachment = { id: crypto.randomUUID(), vaultId, folderId: null, path: '/Meeting.webm', name: 'Meeting.webm', mime: 'audio/webm;codecs=opus', size: 5, storage: 'indexeddb', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, trashGroupId: null, recording: { recordedAt: new Date().toISOString(), durationMs: 1200 } };
    const addAttachment = vi.fn(async () => attachment);
    const saveNote = vi.fn(async () => note);
    const repository = { addAttachment, getAttachmentBlob: vi.fn(async () => new Blob(['voice'], { type: attachment.mime })), getNote: vi.fn(async () => note), listTree: vi.fn(async () => ({ notes: [toNoteEntry(note)] })), saveNote, renameAttachmentWithLinks: vi.fn(async () => attachment) };
    const workspace = { activeVault: { id: vaultId }, repository, notes: [toNoteEntry(note)], attachments: [], selectedFolderId: null, flushPending: vi.fn(async () => undefined), refreshActive: vi.fn(async () => undefined), selectNote: vi.fn(async () => true) } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onOpenNote = vi.fn();
    render(<AudioRecorder workspace={workspace} initialNoteId={note.id} onClose={vi.fn()} onOpenNote={onOpenNote} onOpenTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByLabelText('Playback unsaved recording');
    fireEvent.change(screen.getByLabelText('Recording name'), { target: { value: 'Meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save recording' }));
    await waitFor(() => expect(addAttachment).toHaveBeenCalledWith(vaultId, null, expect.any(Blob), 'Meeting.webm', expect.objectContaining({ recordedAt: expect.any(String), durationMs: expect.any(Number) })));
    await screen.findByRole('button', { name: 'Attach to note' });
    fireEvent.change(screen.getByLabelText('Rename recording'), { target: { value: 'Interview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview rename' }));
    await screen.findByText('0 linked notes will be updated.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply rename' }));
    await waitFor(() => expect(repository.renameAttachmentWithLinks).toHaveBeenCalledWith(attachment.id, 'Interview.webm', attachment.path, attachment.updatedAt, [], [{ id: note.id, revision: note.revision }]));
    fireEvent.click(screen.getByRole('button', { name: 'Attach to note' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(note.id, { markdown: '# Today\n\n[Meeting.webm](Meeting.webm)\n' }, true));
    expect(onOpenNote).toHaveBeenCalledWith(note.id);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiGateway, setAiMode, setAiScopePermission, defaultAiPolicy } from '@noor-note/ai';
import { AiNoteActions } from '../src/components/AiNoteActions';
import { saveAiPolicy } from '../src/lib/ai-policy-storage';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('AI note action review', () => {
  it('does not generate before review, previews the result, and applies only on acceptance', async () => {
    const gateway = new AiGateway();
    const complete = vi.fn(async () => ({ text: 'Short summary', model: 'test' }));
    gateway.registerChat({ descriptor: { id: 'test.local', name: 'Test local', model: 'test', execution: 'onDevice', recipient: null, capabilities: ['chat'] }, complete });
    saveAiPolicy(localStorage, setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true));
    const source = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), path: '/Private.md', title: 'Private', markdown: 'Private source text.' };
    const apply = vi.fn(() => true), undo = vi.fn(() => true);
    render(<AiNoteActions action="summarize-note" source={source} selection={null} gateway={gateway} onClose={() => undefined} onApplyEdit={apply} onApplyTitle={() => false} onUndoEdit={undo} onUndoTitle={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    expect((await screen.findByRole('region', { name: 'AI request review' })).textContent).toContain('Private source text.');
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and generate' }));
    expect((await screen.findByRole('region', { name: 'AI suggestion preview' })).textContent).toContain('Suggestion preview');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(apply).toHaveBeenCalledWith(source, expect.objectContaining({ after: expect.stringContaining('Short summary') }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledWith(source.id, expect.stringContaining('Short summary'));
  });

  it('keeps generation unavailable when AI permissions are off', async () => {
    const gateway = new AiGateway();
    gateway.registerChat({ descriptor: { id: 'test.local', name: 'Test local', model: 'test', execution: 'onDevice', recipient: null, capabilities: ['chat'] }, complete: async () => ({ text: 'Unexpected', model: 'test' }) });
    const source = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), path: '/Private.md', title: 'Private', markdown: 'Private source text.' };
    render(<AiNoteActions action="rewrite" source={source} selection={null} gateway={gateway} onClose={() => undefined} onApplyEdit={() => false} onApplyTitle={() => false} onUndoEdit={() => false} onUndoTitle={() => false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review request' }).hasAttribute('disabled')).toBe(true));
  });

  it('saves reviewed flashcard suggestions as study cards and can undo them', async () => {
    const gateway = new AiGateway();
    gateway.registerChat({ descriptor: { id: 'test.local', name: 'Test local', model: 'test', execution: 'onDevice', recipient: null, capabilities: ['chat'] }, complete: async () => ({ text: 'Q:: Water?\nA:: H2O', model: 'test' }) });
    saveAiPolicy(localStorage, setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true));
    const source = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), path: '/Science.md', title: 'Science', markdown: 'Water notes.' };
    const save = vi.fn(async () => ['card-id']), undo = vi.fn(async () => undefined);
    render(<AiNoteActions action="generate-flashcards" source={source} selection={null} gateway={gateway} onClose={() => undefined} onApplyEdit={() => false} onApplyTitle={() => false} onUndoEdit={() => false} onUndoTitle={() => false} onSaveStudyCards={save} onUndoStudyCards={undo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and generate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add as study cards' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(source, [expect.objectContaining({ front: 'Water?', back: 'H2O', sourceKind: 'ai' })]));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith(['card-id']));
  });
});

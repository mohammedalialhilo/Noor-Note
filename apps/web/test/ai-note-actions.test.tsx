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
});

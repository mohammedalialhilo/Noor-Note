// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AiSettings } from '../src/components/AiSettings';
import { AI_POLICY_STORAGE_KEY, loadAiPolicy } from '../src/lib/ai-policy-storage';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('AI privacy settings', () => {
  it('starts disabled, persists explicit scope permissions, and clears them when disabled again', async () => {
    render(<AiSettings />);
    const mode = screen.getByRole('combobox', { name: 'AI mode' }) as HTMLSelectElement;
    const current = screen.getByRole('checkbox', { name: /Current note/ }) as HTMLInputElement;
    expect(mode.value).toBe('disabled');
    expect(current.matches(':disabled')).toBe(true);
    expect(screen.getByText('Local SmolLM2 (on this device)')).toBeTruthy();
    fireEvent.change(mode, { target: { value: 'explicit' } });
    await waitFor(() => expect(current.matches(':disabled')).toBe(false));
    fireEvent.click(current);
    await waitFor(() => expect(loadAiPolicy(localStorage).allow.currentNote).toBe(true));
    expect(loadAiPolicy(localStorage).mode).toBe('explicit');
    fireEvent.change(mode, { target: { value: 'disabled' } });
    await waitFor(() => expect(loadAiPolicy(localStorage).allow.currentNote).toBe(false));
    expect(loadAiPolicy(localStorage).mode).toBe('disabled');
  });

  it('fails closed on malformed saved values', () => {
    localStorage.setItem(AI_POLICY_STORAGE_KEY, '{broken');
    expect(loadAiPolicy(localStorage).mode).toBe('disabled');
    localStorage.setItem(AI_POLICY_STORAGE_KEY, JSON.stringify({ version: 1, mode: 'explicit', allow: { currentNote: true } }));
    expect(loadAiPolicy(localStorage).mode).toBe('disabled');
  });
});

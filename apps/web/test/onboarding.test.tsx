// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../src/components/OnboardingDialog';
import { completeOnboarding, shouldShowOnboarding } from '../src/lib/onboarding';
import { filesFromDirectory } from '../src/lib/directory-import';

describe('first-run onboarding', () => {
  it('appears only for a fresh workspace and records completion', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(shouldShowOnboarding(null, storage)).toBe(false);
    expect(shouldShowOnboarding(false, storage)).toBe(false);
    expect(shouldShowOnboarding(true, storage)).toBe(true);
    expect(completeOnboarding(storage)).toBe(true);
    expect(shouldShowOnboarding(true, storage)).toBe(false);
    expect(shouldShowOnboarding(true, null)).toBe(true);
    expect(completeOnboarding(null)).toBe(false);
  });

  it('preserves nested folder paths for Import Center without reading file bytes', async () => {
    const file = new File(['# Note'], 'Note.md', { type: 'text/markdown' });
    const folder = (name: string, children: unknown[]) => ({ kind: 'directory', name, values: async function* () { yield* children; } }) as FileSystemDirectoryHandle;
    const root = folder('Source', [folder('Projects', [{ kind: 'file', name: 'Note.md', getFile: async () => file }])]);
    const files = await filesFromDirectory(root);
    expect(files).toHaveLength(1);
    expect((files[0] as File & { noorRelativePath: string }).noorRelativePath).toBe('Projects/Note.md');
    await expect(filesFromDirectory(root, 0)).rejects.toThrow('more than 0 files');
  });

  it('offers setup choices and a one-page skippable tutorial', async () => {
    const onCreate = vi.fn(async () => true);
    const onSkip = vi.fn();
    const onImport = vi.fn();
    const onOpenFolder = vi.fn(async () => true);
    const callbacks = { onCreate, onImport, onOpenFolder, onSignIn: vi.fn(), onContinue: vi.fn(), onSkip, onFinish: vi.fn() };
    const { rerender } = render(<OnboardingDialog phase="choice" folderAvailable accountAvailable {...callbacks} />);
    expect(screen.getByRole('button', { name: /Open filesystem folder/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue without account/ }));
    expect(callbacks.onSignIn).toHaveBeenCalledOnce();
    expect(callbacks.onContinue).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name your local vault' }), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create local vault' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Research'));
    rerender(<OnboardingDialog phase="tour" folderAvailable accountAvailable {...callbacks} />);
    for (const topic of ['Notes', 'Wiki links', 'Backlinks', 'Search', 'Command palette', 'Properties', 'Canvas', 'Bases']) expect(screen.getByText(topic)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

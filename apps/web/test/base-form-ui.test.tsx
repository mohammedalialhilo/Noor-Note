// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBaseForm } from '@noor-note/core';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';
import { BaseFormPanel } from '../src/components/BaseFormPanel';

afterEach(cleanup);
const workspace = { folders: [], notes: [], activeVault: { settings: { templates: { folderId: null } } } } as unknown as ReturnType<typeof useVaultWorkspace>;

describe('Base form panel', () => {
  it('validates required answers and submits a note through the form callback', async () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<BaseFormPanel form={newBaseForm()} workspace={workspace} readOnly={false} onSave={vi.fn().mockResolvedValue(true)} onSubmit={submit} />);
    fireEvent.submit(screen.getByRole('button', { name: 'Create note' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Title is required.');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'New request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(Object.values(submit.mock.calls[0]![0])).toContain('New request');
  });

  it('saves field and destination configuration through the Base callback', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<BaseFormPanel form={newBaseForm()} workspace={workspace} readOnly={false} onSave={save} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getAllByLabelText('Property key', { selector: 'input' })[1]!, { target: { value: 'requester' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].fields[1].key).toBe('requester');
  });
});

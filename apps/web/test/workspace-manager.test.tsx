// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { workspaceSchema } from '@noor-note/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceManager } from '../src/components/WorkspaceManager';
import { defaultWorkspaceLayout } from '../src/lib/workspace-layout';

afterEach(cleanup);

describe('Workspace manager', () => {
  it('creates, loads, sets startup, and adjusts saved panel widths through callbacks', async () => {
    const id = crypto.randomUUID(), vaultId = crypto.randomUUID(), now = new Date().toISOString();
    const saved = workspaceSchema.parse({ id, vaultId, name: 'Research', layout: defaultWorkspaceLayout(), createdAt: now, updatedAt: now });
    const onCreate = vi.fn(async () => true), onLoad = vi.fn(async () => true), onStartup = vi.fn(), onWidthsChange = vi.fn();
    render(<WorkspaceManager open onOpenChange={vi.fn()} workspaces={[saved]} activeId={null} startupId={null} widths={{ navigationWidth: 244, noteListWidth: 308, inspectorWidth: 232 }} error={null} onWidthsChange={onWidthsChange} onCreate={onCreate} onUpdate={vi.fn(async () => true)} onLoad={onLoad} onDuplicate={vi.fn(async () => true)} onRename={vi.fn(async () => true)} onDelete={vi.fn(async () => true)} onStartup={onStartup} />);
    fireEvent.change(screen.getByLabelText('New workspace name'), { target: { value: 'Writing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current layout' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Writing'));
    fireEvent.click(screen.getByRole('button', { name: 'Set startup' }));
    expect(onStartup).toHaveBeenCalledWith(id);
    fireEvent.change(screen.getByLabelText('Navigation'), { target: { value: '300' } });
    expect(onWidthsChange).toHaveBeenCalledWith(expect.objectContaining({ navigationWidth: 300 }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(id));
  });
});

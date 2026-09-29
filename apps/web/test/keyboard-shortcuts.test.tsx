// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcuts } from '../src/components/KeyboardShortcuts';
import { commandRegistry } from '../src/lib/commands';

afterEach(() => cleanup());

describe('keyboard shortcut settings', () => {
  it('captures, removes, resets, and reports conflicting bindings', () => {
    const command = commandRegistry.get('navigation.quick-switcher')!;
    let conflict = false;
    const onChange = vi.fn((...args: [string, string | null | undefined]): string | null => { if (args.length !== 2) throw new Error('Invalid shortcut update'); return conflict ? 'Mod+P is already assigned to Open command palette.' : null; });
    const { rerender } = render(<KeyboardShortcuts commands={[command]} overrides={{}} onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search commands' }), { target: { value: 'quick switcher' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Press shortcut for Open quick switcher' }), { key: 'j', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(command.id, 'Mod+Shift+J');
    rerender(<KeyboardShortcuts commands={[command]} overrides={{ [command.id]: 'Mod+Shift+J' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith(command.id, null);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenCalledWith(command.id, undefined);
    conflict = true;
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Press shortcut for Open quick switcher' }), { key: 'p', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toContain('already assigned');
  });
});

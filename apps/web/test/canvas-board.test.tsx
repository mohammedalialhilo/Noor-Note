// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendCanvasNode, createCanvasNode, newCanvasDocument } from '@noor-note/core';
import { CanvasBoard } from '../src/components/CanvasBoard';

afterEach(cleanup);

describe('Canvas board', () => {
  it('pans from a touch drag on empty canvas without requiring the pan tool', () => {
    const document = newCanvasDocument();
    const onViewport = vi.fn();
    render(<CanvasBoard document={document} viewport={document.viewport} selected={new Set()} selectedEdge={null} tool="select" notes={[]} attachments={[]} repository={null} onViewport={onViewport} onCommit={vi.fn()} onSelect={vi.fn()} onSelectEdge={vi.fn()} onOpenNote={vi.fn()} onEditText={vi.fn()} onShortcut={vi.fn()} />);
    const board = screen.getByRole('region', { name: 'Noor Canvas board' });
    Object.defineProperty(board, 'setPointerCapture', { value: vi.fn() });
    fireEvent.pointerDown(board, { button: 0, pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 30 });
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 70 });
    expect(onViewport).toHaveBeenCalledWith({ x: 30, y: 40, zoom: 1 });
  });

  it('renders Markdown cards and supports keyboard selection and board shortcuts', () => {
    const card = createCanvasNode('text', 10, 20, { text: '# An idea' });
    const document = appendCanvasNode(newCanvasDocument(), card);
    const onSelect = vi.fn();
    const onShortcut = vi.fn();
    render(<CanvasBoard document={document} viewport={document.viewport} selected={new Set()} selectedEdge={null} tool="select" notes={[]} attachments={[]} repository={null} onViewport={vi.fn()} onCommit={vi.fn()} onSelect={onSelect} onSelectEdge={vi.fn()} onOpenNote={vi.fn()} onEditText={vi.fn()} onShortcut={onShortcut} />);
    expect(screen.getByRole('heading', { name: 'An idea' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('group', { name: /text card: # An idea/u }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(new Set([card.id]));
    fireEvent.keyDown(screen.getByRole('region', { name: 'Noor Canvas board' }), { key: 'Delete' });
    expect(onShortcut).toHaveBeenCalled();
  });
});

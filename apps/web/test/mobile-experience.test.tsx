// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNavigation } from '../src/components/ShellNavigation';
import { useMobileViewport } from '../src/hooks/useMobileViewport';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('mobile navigation', () => {
  it('keeps primary destinations visible and opens search and the full drawer', () => {
    const onNavigate = vi.fn();
    const onSearch = vi.fn();
    const onMore = vi.fn();
    render(<MobileBottomNavigation view="tasks" onNavigate={onNavigate} onSearch={onSearch} onMore={onMore} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.textContent)).toEqual(['Notes', 'Tasks', 'Calendar', 'Search', 'More']);
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'More navigation' }));
    expect(onNavigate).toHaveBeenCalledWith('periods');
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

describe('mobile visible viewport', () => {
  it('adjusts shell height and keyboard state and cleans up listeners', () => {
    const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = Object.assign(new EventTarget(), { height: 780, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    try {
      const { unmount } = renderHook(() => useMobileViewport());
      expect(document.documentElement.style.getPropertyValue('--nn-visible-height')).toBe('780px');
      expect(document.documentElement.dataset.keyboardOpen).toBe('false');
      viewport.height = 470;
      viewport.dispatchEvent(new Event('resize'));
      expect(document.documentElement.style.getPropertyValue('--nn-visible-height')).toBe('470px');
      expect(document.documentElement.dataset.keyboardOpen).toBe('true');
      unmount();
      expect(document.documentElement.style.getPropertyValue('--nn-visible-height')).toBe('');
      expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
    } finally {
      if (previous) Object.defineProperty(window, 'visualViewport', previous);
      else Reflect.deleteProperty(window, 'visualViewport');
    }
  });
});

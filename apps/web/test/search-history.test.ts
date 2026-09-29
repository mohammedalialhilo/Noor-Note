// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { addRecentSearch, readSearchHistory, toggleSavedSearch } from '../src/lib/search-history';

afterEach(() => localStorage.clear());

describe('search preferences', () => {
  it('keeps recent and saved queries per vault with runtime validation', () => {
    const vault = crypto.randomUUID();
    expect(addRecentSearch(vault, 'tag:work').recent).toEqual(['tag:work']);
    expect(addRecentSearch(vault, 'status:draft').recent).toEqual(['status:draft', 'tag:work']);
    expect(toggleSavedSearch(vault, 'tag:work').saved).toEqual(['tag:work']);
    expect(readSearchHistory(crypto.randomUUID())).toEqual({ recent: [], saved: [] });
    localStorage.setItem(`noor-note-search:${vault}`, '{"recent":"broken"}');
    expect(readSearchHistory(vault)).toEqual({ recent: [], saved: [] });
  });
});

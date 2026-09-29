'use client';

import type { SearchMode, SearchResult, SearchSort } from '@noor-note/search';
import type { SearchHistory } from '../lib/search-history';
import styles from './SearchTools.module.css';

interface Props {
  query: string; sort: SearchSort; history: SearchHistory; error: string | null; loading: boolean;
  onSort: (sort: SearchSort) => void; onQuery: (query: string) => void; onSave: () => void;
  mode: SearchMode; onMode: (mode: SearchMode) => void; semanticReady: boolean; onStartSemantic: () => void; progress: string | null;
}

export function SearchTools({ query, sort, history, error, loading, onSort, onQuery, onSave, mode, onMode, semanticReady, onStartSemantic, progress }: Props) {
  return <div className={styles.tools}>
    <div className={styles.modes} role="group" aria-label="Search mode">{(['lexical', 'semantic', 'hybrid'] as const).map((item) => <button type="button" key={item} aria-pressed={mode === item} onClick={() => onMode(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div>
    <div className={styles.top}><select aria-label="Sort search results" value={sort} disabled={mode !== 'lexical'} onChange={(event) => onSort(event.target.value as SearchSort)}><option value="relevance">Most relevant</option><option value="updated">Recently updated</option><option value="created">Recently created</option><option value="title">Title</option></select><button type="button" disabled={!query.trim()} onClick={onSave}>{history.saved.includes(query.trim()) ? 'Remove saved' : 'Save search'}</button></div>
    {mode !== 'lexical' && !semanticReady && <div className={styles.semanticNotice}><p>The first semantic query builds a derived index here and downloads a multilingual model from Hugging Face (about 140 MB). Notes and queries stay on this device.</p><button type="button" onClick={onStartSemantic}>Enable local semantic search</button></div>}
    {mode !== 'lexical' && semanticReady && <p className={styles.hint}>Local semantic index · note passages only · no note text sent to a server.</p>}
    {(history.saved.length > 0 || history.recent.length > 0) && <div className={styles.history}>{history.saved.slice(0, 3).map((item) => <button type="button" key={`saved:${item}`} onClick={() => onQuery(item)}>★ {item}</button>)}{history.recent.filter((item) => !history.saved.includes(item)).slice(0, 3).map((item) => <button type="button" key={`recent:${item}`} onClick={() => onQuery(item)}>{item}</button>)}</div>}
    {error ? <p role="alert" className={styles.error}>{error}</p> : loading ? <p role="status" className={styles.status}>{progress ?? 'Searching local notes…'}</p> : null}
    {mode === 'lexical' && <p className={styles.hint}>Try <code>&quot;exact phrase&quot;</code>, <code>term*</code>, <code>term~</code>, <code>tag:work</code>, <code>status:draft</code>, <code>before:2026-09-01</code>, <code>has:task</code>, or <code>regex:/pattern/</code>.</p>}
  </div>;
}

export function SearchSnippet({ result }: { result: SearchResult }) {
  const spans = [...result.highlights].sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    pieces.push(result.excerpt.slice(cursor, span.start));
    pieces.push(<mark className={styles.highlight} key={`${span.start}:${span.end}`}>{result.excerpt.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  }
  pieces.push(result.excerpt.slice(cursor));
  return <><small className={styles.path}>{result.path}{result.heading ? ` · ${result.heading}` : ''}{result.similarity !== undefined ? ` · cosine ${result.similarity.toFixed(2)}` : ''}</small><p>{pieces}</p>{result.properties.length > 0 && <small className={styles.properties}>{result.properties.map((item) => `${item.name}: ${item.value}`).join(' · ')}</small>}</>;
}

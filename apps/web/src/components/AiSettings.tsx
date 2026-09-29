'use client';

import { useState, useSyncExternalStore } from 'react';
import { defaultAiPolicy, setAiMode, setAiScopePermission, type AiPolicy } from '@noor-note/ai';
import { aiGateway } from '../lib/ai-runtime';
import { aiPolicySnapshot, parseAiPolicyJson, saveAiPolicy, subscribeAiPolicy } from '../lib/ai-policy-storage';
import styles from './AiSettings.module.css';

const scopes: { kind: keyof AiPolicy['allow']; title: string; detail: string }[] = [
  { kind: 'currentNote', title: 'Current note', detail: 'The note currently open in the editor.' },
  { kind: 'selectedNotes', title: 'Selected notes', detail: 'Only notes selected for a specific request.' },
  { kind: 'baseResults', title: 'Base results', detail: 'Visible result notes from a chosen Base.' },
  { kind: 'vaultRetrieval', title: 'Folder and vault retrieval', detail: 'Matching passages retrieved from a folder or vault, reviewed before sending.' },
];

export function AiSettings() {
  const raw = useSyncExternalStore(subscribeAiPolicy, aiPolicySnapshot, () => null);
  const policy = raw === null ? defaultAiPolicy : parseAiPolicyJson(raw);
  const [error, setError] = useState<string | null>(null);
  const providers = aiGateway.listProviders();
  const persist = (next: AiPolicy) => {
    try { saveAiPolicy(window.localStorage, next); setError(null); }
    catch { setError('Could not save AI permissions in this browser. AI remains disabled for new requests.'); }
  };

  return <section className={styles.card} aria-labelledby="ai-settings-heading">
    <div className={styles.heading}><h2 id="ai-settings-heading">AI privacy</h2><p>Noor Note works with AI disabled. These settings govern AI note actions and vault chat. Local OCR and transcription remain separate, user-invoked tools.</p></div>
    <label className={styles.mode}>AI mode
      <select value={policy.mode} onChange={(event) => persist(setAiMode(policy, event.target.value === 'explicit' ? 'explicit' : 'disabled'))}>
        <option value="disabled">AI disabled</option>
        <option value="explicit">Only when I explicitly invoke it</option>
      </select>
    </label>
    <fieldset className={styles.scopes} disabled={policy.mode === 'disabled'}>
      <legend>Content scopes this device may offer to AI</legend>
      {scopes.map((scope) => <label key={scope.kind} className={styles.scope}>
        <input type="checkbox" checked={policy.allow[scope.kind]} onChange={(event) => persist(setAiScopePermission(policy, scope.kind, event.target.checked))} />
        <span><strong>{scope.title}</strong><small>{scope.detail}</small></span>
      </label>)}
    </fieldset>
    <p className={styles.notice}>Each request shows the provider, destination, scope, prompt, and exact note content for separate approval. Turning AI off clears these scope permissions.</p>
    <div className={styles.provider}><strong>Assistant providers</strong><span>{providers.length ? providers.map((item) => `${item.name} (${item.execution === 'onDevice' ? 'on this device' : item.recipient})`).join(', ') : 'None configured.'}</span></div>
    <p className={styles.notice}>Local SmolLM2 note actions and vault chat require an explicit request and an approximately 182 MB first-use model download. The model works best with short English text; review suggestions and cited answers.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

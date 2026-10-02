'use client';

import { Dialog } from '@noor-note/ui';
import { BookOpenText, Command, Database, FolderOpen, Link2, Network, PanelsTopLeft, Search, ShieldCheck, Tags, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BrandMark } from './BrandMark';
import styles from './OnboardingDialog.module.css';

export type OnboardingPhase = 'choice' | 'tour' | null;

interface Props {
  phase: OnboardingPhase;
  folderAvailable: boolean;
  accountAvailable: boolean;
  onCreate: (name: string) => Promise<boolean>;
  onImport: () => void;
  onOpenFolder: () => Promise<boolean>;
  onSignIn: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

const topics = [
  { icon: BookOpenText, title: 'Notes', text: 'Write portable Markdown. Your notes are available offline.' },
  { icon: Link2, title: 'Wiki links', text: 'Type [[Note name]] to connect one note to another.' },
  { icon: Network, title: 'Backlinks', text: 'See which notes point to the note you are reading.' },
  { icon: Search, title: 'Search', text: 'Find notes by words, tags, paths, and properties.' },
  { icon: Command, title: 'Command palette', text: 'Press Ctrl/Cmd + P to find actions from the keyboard.' },
  { icon: Tags, title: 'Properties', text: 'Add structured fields while keeping YAML frontmatter portable.' },
  { icon: PanelsTopLeft, title: 'Canvas', text: 'Arrange notes and media on a visual board.' },
  { icon: Database, title: 'Bases', text: 'Build saved views over your Markdown notes and properties.' },
] as const;

export function OnboardingDialog({ phase, folderAvailable, accountAvailable, onCreate, onImport, onOpenFolder, onSignIn, onContinue, onSkip, onFinish }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try { if (!await onCreate(name.trim())) setError('Could not create the vault. Check the name and try again.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the vault.'); }
    finally { setBusy(false); }
  };
  const openFolder = async () => {
    setBusy(true); setError(null);
    try { await onOpenFolder(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the folder.'); }
    finally { setBusy(false); }
  };
  return <Dialog open={phase !== null} onOpenChange={(open) => { if (!open) onSkip(); }} title={phase === 'tour' ? 'A quick tour of Noor Note' : 'Welcome to Noor Note'} description={phase === 'tour' ? 'A few ideas to help you get started. Skip whenever you like.' : 'Choose how to begin. Your work stays in this browser unless you later enable cloud sync.'} contentClassName={styles.dialog}>
    {phase === 'choice' ? <>
      <div className={styles.brand}><BrandMark size={34} /><span>Local-first by default</span></div>
      <form className={styles.create} onSubmit={(event) => { void create(event); }}>
        <label htmlFor="onboarding-vault-name">Name your local vault</label>
        <div><input id="onboarding-vault-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required placeholder="My vault" /><button type="submit" disabled={busy || !name.trim()}>Create local vault</button></div>
      </form>
      <div className={styles.choices}>
        <button type="button" disabled={busy} onClick={onImport}><Upload size={19} /><span><strong>Import Markdown vault</strong><small>Preview Markdown, folders, and attachments before importing.</small></span></button>
        {folderAvailable && <button type="button" disabled={busy} onClick={() => { void openFolder(); }}><FolderOpen size={19} /><span><strong>Open filesystem folder</strong><small>Read a local folder and review its files in Import Center.</small></span></button>}
        <button type="button" disabled={busy || !accountAvailable} onClick={onSignIn}><ShieldCheck size={19} /><span><strong>Sign in</strong><small>{accountAvailable ? 'Connect an optional Noor Note account.' : 'Accounts are unavailable on this deployment.'}</small></span></button>
        <button type="button" disabled={busy} onClick={onContinue}><BookOpenText size={19} /><span><strong>Continue without account</strong><small>Use the local vault already created in this browser.</small></span></button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="button" className={styles.skip} disabled={busy} onClick={onSkip}>Skip setup</button>
    </> : phase === 'tour' ? <>
      <div className={styles.topics}>{topics.map(({ icon: Icon, title, text }) => <div key={title} className={styles.topic}><Icon size={18} aria-hidden="true" /><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
      <div className={styles.footer}><button type="button" className={styles.skip} onClick={onSkip}>Skip tutorial</button><button type="button" className={styles.primary} onClick={onFinish}>Start writing</button></div>
    </> : null}
  </Dialog>;
}

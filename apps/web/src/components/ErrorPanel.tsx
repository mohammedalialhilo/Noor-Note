'use client';

import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import styles from './ErrorPanel.module.css';

type ErrorPanelProps = {
  title: string;
  message: string;
  onRetry?: () => void;
  isError?: boolean;
};

export function ErrorPanel({ title, message, onRetry, isError = true }: ErrorPanelProps) {
  const titleId = useId();

  return (
    <section className={styles.panel} role={isError ? 'alert' : undefined} aria-labelledby={titleId}>
      <div className={styles.icon} aria-hidden="true"><AlertCircle size={24} strokeWidth={1.8} /></div>
      <p className={styles.eyebrow}>NOOR NOTE</p>
      <h1 id={titleId}>{title}</h1>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        {onRetry && <button type="button" className={styles.primary} onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />Try again</button>}
        <a className={styles.secondary} href="/"><ArrowLeft size={16} aria-hidden="true" />Go to workspace</a>
      </div>
    </section>
  );
}

'use client';

import { useEffect } from 'react';
import './globals.css';
import { ErrorPanel } from '../components/ErrorPanel';
import styles from '../components/ErrorPanel.module.css';
import { getUserErrorMessage, logError } from '../lib/logger';

export default function GlobalError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    logError('global', error);
    try {
      const preference = window.localStorage.getItem('noor-note-theme');
      if (preference === 'light' || preference === 'dark') {
        document.documentElement.dataset.theme = preference;
      } else {
        delete document.documentElement.dataset.theme;
      }
    } catch {
      // A blocked storage API must not stop error recovery.
    }
  }, [error]);

  return (
    <html lang="en">
      <head><title>Noor Note — Error</title></head>
      <body className={styles.globalBody}>
        <main className={styles.page}>
          <ErrorPanel title="Noor Note could not start" message={getUserErrorMessage(error, 'render')} onRetry={retry} />
        </main>
      </body>
    </html>
  );
}

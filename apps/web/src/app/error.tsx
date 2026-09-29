'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '../components/ErrorPanel';
import styles from '../components/ErrorPanel.module.css';
import { getUserErrorMessage, logError } from '../lib/logger';

export default function RouteError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => logError('route', error), [error]);

  return (
    <main className={styles.page}>
      <ErrorPanel title="Something went wrong" message={getUserErrorMessage(error, 'render')} onRetry={retry} />
    </main>
  );
}

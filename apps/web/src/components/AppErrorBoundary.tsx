'use client';

import { Component, type ReactNode } from 'react';
import { ErrorPanel } from './ErrorPanel';
import styles from './ErrorPanel.module.css';
import { getUserErrorMessage, logError } from '../lib/logger';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    logError('workspace.render', error);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <main className={styles.page}>
          <ErrorPanel title="The workspace could not open" message={getUserErrorMessage(this.state.error, 'render')} onRetry={this.retry} />
        </main>
      );
    }
    return this.props.children;
  }
}

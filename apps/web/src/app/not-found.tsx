import { ErrorPanel } from '../components/ErrorPanel';
import styles from '../components/ErrorPanel.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <ErrorPanel title="Page not found" message="This address does not match a Noor Note page." isError={false} />
    </main>
  );
}

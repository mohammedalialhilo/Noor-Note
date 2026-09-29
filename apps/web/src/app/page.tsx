import { Workspace } from '../components/Workspace';
import { AppErrorBoundary } from '../components/AppErrorBoundary';

export default function HomePage() {
  return <AppErrorBoundary><Workspace /></AppErrorBoundary>;
}

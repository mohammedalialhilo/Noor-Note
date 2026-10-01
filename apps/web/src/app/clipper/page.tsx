import { AppErrorBoundary } from '../../components/AppErrorBoundary';
import { ClipReview } from '../../components/ClipReview';

export default function ClipperPage() {
  return <AppErrorBoundary><ClipReview /></AppErrorBoundary>;
}

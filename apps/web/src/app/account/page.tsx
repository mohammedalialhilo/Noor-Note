import type { Metadata } from 'next';
import { AccountScreen } from '../../components/AccountScreen';
import { AppErrorBoundary } from '../../components/AppErrorBoundary';

export const metadata: Metadata = { title: 'Account · Noor Note', description: 'Optional Noor Note account sign-in and recovery.' };

export default function AccountPage() {
  return <AppErrorBoundary><AccountScreen /></AppErrorBoundary>;
}

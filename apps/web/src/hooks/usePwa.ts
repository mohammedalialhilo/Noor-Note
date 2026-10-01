'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;
}

export function usePwa() {
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const installPrompt = useRef<InstallPromptEvent | null>(null);
  const reloadAfterUpdate = useRef(false);
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sync = () => setOnline(navigator.onLine);
    const prompt = (event: Event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault();
      installPrompt.current = event;
      setInstallAvailable(true);
    };
    const onInstalled = () => { installPrompt.current = null; setInstallAvailable(false); setInstalled(true); };
    const onControllerChange = () => { if (reloadAfterUpdate.current) window.location.reload(); };
    sync();
    queueMicrotask(() => { if (active) setInstalled(window.matchMedia?.('(display-mode: standalone)').matches ?? false); });
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('beforeinstallprompt', prompt);
    window.addEventListener('appinstalled', onInstalled);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((value) => {
        if (!active) return;
        registration.current = value;
        const checkWaiting = () => {
          if (value.waiting && navigator.serviceWorker.controller) setUpdateAvailable(true);
        };
        checkWaiting();
        const onUpdateFound = () => {
          const worker = value.installing;
          worker?.addEventListener('statechange', () => {
            if (!active) return;
            if (worker.state === 'installed') checkWaiting();
            if (worker.state === 'redundant') setError('The Noor Note update could not be installed. Try again while online.');
          });
        };
        value.addEventListener('updatefound', onUpdateFound);
        void navigator.serviceWorker.ready.then(() => { if (active) setOfflineReady(true); }).catch(() => undefined);
        const checkForUpdates = () => {
          if (navigator.onLine && document.visibilityState === 'visible') void value.update().catch(() => undefined);
        };
        window.addEventListener('online', checkForUpdates);
        document.addEventListener('visibilitychange', checkForUpdates);
        const timer = window.setInterval(checkForUpdates, 60 * 60 * 1000);
        // Remove registration-specific listeners even if this component unmounts.
        cleanupRegistration.current = () => {
          value.removeEventListener('updatefound', onUpdateFound);
          window.removeEventListener('online', checkForUpdates);
          document.removeEventListener('visibilitychange', checkForUpdates);
          window.clearInterval(timer);
        };
      }).catch(() => { if (active) setError('Offline installation is unavailable in this browser. Local vault storage still works.'); });
    }
    return () => {
      active = false;
      cleanupRegistration.current?.(); cleanupRegistration.current = null;
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', onInstalled);
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const cleanupRegistration = useRef<(() => void) | null>(null);
  const install = useCallback(async () => {
    const pending = installPrompt.current;
    if (!pending) return;
    try {
      await pending.prompt();
      await pending.userChoice;
      installPrompt.current = null;
      setInstallAvailable(false);
    } catch { setError('The browser could not show the install prompt. Try its Install app menu.'); }
  }, []);
  const applyUpdate = useCallback(async (beforeReload: () => Promise<void>) => {
    const waiting = registration.current?.waiting;
    if (!waiting) { setUpdateAvailable(false); return; }
    try {
      await beforeReload();
      reloadAfterUpdate.current = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch { setError('Save the current note before updating Noor Note.'); }
  }, []);
  return { online, offlineReady, installAvailable, installed, updateAvailable, error, install, applyUpdate, clearError: () => setError(null) };
}

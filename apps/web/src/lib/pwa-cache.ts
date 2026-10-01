/** Remove account-scoped Cache Storage entries while preserving the public shell and local vault databases. */
export async function purgeAccountCaches(): Promise<void> {
  if (typeof caches !== 'undefined') {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => /^noor-note-(?:private|runtime|user)-/u.test(name)).map((name) => caches.delete(name)));
  }
  if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE_PRIVATE_CACHES' });
}

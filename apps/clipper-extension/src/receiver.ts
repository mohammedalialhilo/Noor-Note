const ticket = new URL(location.href).searchParams.get('ticket');
if (ticket && location.pathname === '/clipper/') {
  const send = () => {
    chrome.runtime.sendMessage({ kind: 'getPending', ticket }, (response: { ok?: boolean; result?: unknown } | undefined) => {
      if (!response?.ok || !response.result) return;
      window.postMessage({ type: 'noor-note-clip', ticket, clip: response.result }, location.origin);
    });
  };
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if ((event.source !== window && event.source !== null) || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (data.ticket !== ticket) return;
    if (data.type === 'noor-note-clip-ready') send();
    if (data.type === 'noor-note-clip-accepted') chrome.runtime.sendMessage({ kind: 'ack', ticket });
  });
  window.postMessage({ type: 'noor-note-clip-extension-ready', ticket }, location.origin);
}

/** Runs only inside an opaque-origin sandboxed iframe. No host objects cross this boundary. */
export const pluginSandboxBootstrap = `(() => {
  'use strict';
  const handlers = new Map();
  const pending = new Map();
  const queued = [];
  let port = null;
  const send = (message) => { if (port) port.postMessage(message); else queued.push(message); };
  const api = Object.freeze({
    register(contribution, handler) {
      if (handler !== undefined && typeof handler !== 'function') throw new TypeError('Handler must be a function');
      if (handler) handlers.set(contribution.id, handler);
      send({ type: 'register', contribution });
    },
    request(action, payload = {}) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Noor Note request timed out')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        send({ type: 'request', id, action, payload });
      });
    },
  });
  Object.defineProperty(globalThis, 'noorNote', { value: api, writable: false, configurable: false });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'noor-note-plugin-init' || port || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = async ({ data }) => {
      if (data?.type === 'request-result') {
        const task = pending.get(data.id);
        if (!task) return;
        clearTimeout(task.timer); pending.delete(data.id);
        if (data.ok) task.resolve(data.value); else task.reject(new Error(data.error || 'Request denied'));
      } else if (data?.type === 'invoke') {
        const handler = handlers.get(data.contributionId);
        if (!handler) { port.postMessage({ type: 'invoke-result', id: data.id, ok: false, error: 'No handler registered' }); return; }
        try { port.postMessage({ type: 'invoke-result', id: data.id, ok: true, value: await handler(data.payload) }); }
        catch (error) { port.postMessage({ type: 'invoke-result', id: data.id, ok: false, error: String(error?.message || 'Plugin action failed').slice(0, 500) }); }
      }
    };
    port.start();
    port.postMessage({ type: 'ready' });
    for (const message of queued.splice(0)) port.postMessage(message);
  });
})();`;

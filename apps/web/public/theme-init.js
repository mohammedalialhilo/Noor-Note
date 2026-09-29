try {
  const preference = localStorage.getItem('noor-note-theme');
  if (preference === 'light' || preference === 'dark') {
    document.documentElement.dataset.theme = preference;
  }
} catch {
  // Storage may be blocked; CSS still follows the system preference.
}

import { useEffect } from 'react';

/** Keep the mobile shell inside the visible viewport when a software keyboard opens. */
export function useMobileViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--nn-visible-height', `${Math.round(viewport.height)}px`);
      root.dataset.keyboardOpen = window.innerWidth <= 900 && window.innerHeight - viewport.height - viewport.offsetTop > 140 ? 'true' : 'false';
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--nn-visible-height');
      delete root.dataset.keyboardOpen;
    };
  }, []);
}

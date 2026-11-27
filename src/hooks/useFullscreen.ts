import { useCallback, useEffect, useState } from 'react';

const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

/** Enters fullscreen on the first user gesture (browsers require one) and exposes a toggle. */
export function useFullscreen() {
  const [on, setOn] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const change = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    const first = () => { if (supported && !standalone && !document.fullscreenElement && sessionStorage.getItem('goplay.fs') !== 'off') void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };
    window.addEventListener('pointerup', first, { once: true });
    return () => { document.removeEventListener('fullscreenchange', change); window.removeEventListener('pointerup', first); };
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) { sessionStorage.setItem('goplay.fs', 'off'); await document.exitFullscreen(); }
      else { sessionStorage.removeItem('goplay.fs'); await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); }
    } catch { /* unsupported (e.g. iPhone Safari: use Add to Home Screen) */ }
  }, []);
  return { on, toggle, supported };
}

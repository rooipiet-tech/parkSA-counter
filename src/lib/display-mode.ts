/**
 * Display-mode helpers (DC-10). Both are evaluated AT CALL TIME — no
 * module-load caching — so tests can override matchMedia/navigator.standalone
 * via init scripts and the app reacts to the live environment.
 */

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* ignore */
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function isIphoneUa(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/i.test(navigator.userAgent);
}

/**
 * Observer codes are pseudonymous: short, no spaces, no real names (POPIA
 * minimality, DC-01). 'OBS-1' is valid; 'John Smith' is not.
 */
export const OBSERVER_CODE_RE = /^[A-Za-z0-9_-]{1,12}$/;

export const OBSERVER_HELPER_TEXT =
  'Use a short code like OBS-1 (max 12 chars, letters/digits/-/_ only). Do not use your real name.';

export function isValidObserverCode(code: string): boolean {
  return OBSERVER_CODE_RE.test(code);
}

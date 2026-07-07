import { expect, type BrowserContext, type Page } from '@playwright/test';
import { toSastDate } from '../src/lib/sast.ts';

export const PIN = '1234';
export const DEFAULT_LOCATION = 'OR Tambo Parkade 2 South Level 3';

/**
 * F9 navigation discipline: gotoApp is the ONLY page.goto a test performs.
 * '?fresh=1' makes the app clear localStorage + IndexedDB BEFORE booting and
 * then strips itself from the URL, so any spec-mandated reload keeps state.
 * View switching afterwards happens exclusively via in-page clicks/hash.
 */
export async function gotoApp(page: Page, opts: { seed?: 'month' } = {}): Promise<void> {
  const url = opts.seed ? '/?fresh=1&seed=month' : '/?fresh=1';
  await page.goto(url);
  await waitForReady(page);
}

export async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __PARKSA__?: unknown }).__PARKSA__ !== undefined ||
      document.querySelector('[data-testid=insecure-context-warning]') !== null
  );
}

/** Spec-mandated 'relaunch': a second page in the same context, no fresh=1. */
export async function relaunch(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await waitForReady(page);
  return page;
}

export async function unlock(page: Page): Promise<void> {
  await page.getByTestId('pin-input').fill(PIN);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('nav-count')).toBeVisible();
}

export async function startSession(page: Page, observer = 'OBS-1'): Promise<void> {
  await page.getByTestId('observer-input').fill(observer);
  await page.getByTestId('session-start').click();
  await expect(page.getByTestId('undo-btn')).toBeVisible();
}

/** One simulated physical tap = pointerdown + pointerup (no synthetic click). */
export async function tapTile(page: Page, providerId: string, times = 1): Promise<void> {
  const tile = page.getByTestId(`tile-${providerId}`);
  for (let i = 0; i < times; i++) {
    await tile.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
    await tile.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  }
}

/** End the session via the POL-03 two-step confirm (click End, then Confirm). */
export async function endSession(page: Page): Promise<void> {
  await page.getByTestId('session-end').click();
  await page.getByTestId('session-end-confirm').click();
}

/** Settings only open via a deliberate >=500ms long-press (AC-11). */
export async function longPressSettingsOpen(page: Page): Promise<void> {
  const btn = page.getByTestId('settings-open');
  await btn.dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true, bubbles: true });
  await page.waitForTimeout(700);
  await btn.dispatchEvent('pointerup', { pointerId: 7, bubbles: true });
  await expect(page.getByTestId('provider-add')).toBeVisible();
}

export async function setForceOffline(page: Page, v: boolean): Promise<void> {
  await page.evaluate((value) => window.__PARKSA__.setForceOffline(value), v);
}

export async function goOnlineAndSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__PARKSA__.setForceOffline(false);
    window.dispatchEvent(new Event('online'));
  });
}

export function getQueueState(page: Page) {
  return page.evaluate(() => window.__PARKSA__.getQueueState());
}

export function getServerState(page: Page) {
  return page.evaluate(() => window.__PARKSA__.getServerState());
}

export async function flush(page: Page): Promise<void> {
  await page.evaluate(() => window.__PARKSA__.flush());
}

/** Today's SAST date as the app computes it (dashboard default range). */
export function todaySast(): string {
  return toSastDate(Date.now());
}

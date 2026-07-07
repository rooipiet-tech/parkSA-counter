import { expect, test } from '@playwright/test';
import { gotoApp, unlock } from './helpers.ts';

test('observer field guides to pseudonymous codes: rejects "John Smith", accepts "OBS-1" (AC-12)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);

  // Guidance text warns against real names.
  const helper = page.getByTestId('observer-helper');
  await expect(helper).toBeVisible();
  await expect(helper).toContainText(/real name/i);

  // A real name is rejected and the session does NOT start.
  await page.getByTestId('observer-input').fill('John Smith');
  await page.getByTestId('session-start').click();
  await expect(page.getByTestId('observer-error')).toBeVisible();
  await expect(page.getByTestId('session-start')).toBeVisible(); // still on the form
  await expect(page.getByTestId('undo-btn')).toHaveCount(0); // no counting screen
  const serverSessions = await page.evaluate(() =>
    window.__PARKSA__.getServerState().then((s) => s.sessions.length)
  );
  expect(serverSessions).toBe(0);
  const queue = await page.evaluate(() => window.__PARKSA__.getQueueState());
  expect(queue.events).toHaveLength(0);

  // A pseudonymous code is accepted.
  await page.getByTestId('observer-input').fill('OBS-1');
  await page.getByTestId('session-start').click();
  await expect(page.getByTestId('undo-btn')).toBeVisible();
  await expect(page.getByTestId('session-info')).toContainText('OBS-1');
});

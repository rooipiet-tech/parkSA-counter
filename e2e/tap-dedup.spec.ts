import { expect, test } from '@playwright/test';
import { getQueueState, gotoApp, startSession, unlock } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
});

test('(a) one physical tap (pointerdown+pointerup+click) records exactly one event (AC-05)', async ({
  page
}) => {
  // A real click produces the full pointerdown/pointerup/click sequence.
  await page.getByTestId('tile-mr-parking-dropoff').click();
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(1);
  expect(state.events[0].provider_id).toBe('mr-parking');
  expect(state.events[0].direction).toBe('dropoff');
});

test('(b) 20 rapid full sequences -> exactly 20 events (AC-05)', async ({ page }) => {
  const half = page.getByTestId('tile-mr-parking-dropoff');
  for (let i = 0; i < 20; i++) {
    await half.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
    await half.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
    await half.dispatchEvent('click', { bubbles: true });
  }
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(20);
});

test('(c) second pointerdown on the SAME half while held is ignored (AC-05)', async ({ page }) => {
  const half = page.getByTestId('tile-mr-parking-dropoff');
  await half.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
  await half.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: false, bubbles: true });
  await half.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });
  await half.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(1);
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('1');
});

test('(e) a scroll-drag starting on a half (pointercancel) records ZERO events (POL-01/AC-05)', async ({
  page
}) => {
  const half = page.getByTestId('tile-mr-parking-dropoff');
  // Touch-drag-to-scroll that begins on the half: pointerdown, a large move,
  // then the browser takes over scrolling and fires pointercancel.
  await half.dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    clientX: 100,
    clientY: 100
  });
  await half.dispatchEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 100, clientY: 300 });
  await half.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(0);
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('0');
});

test('(f) a large-move drag released off-slop (pointerup) records ZERO events (POL-01/AC-05)', async ({
  page
}) => {
  const half = page.getByTestId('tile-mr-parking-dropoff');
  await half.dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    clientX: 100,
    clientY: 100
  });
  await half.dispatchEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 100, clientY: 260 });
  await half.dispatchEvent('pointerup', { pointerId: 1, bubbles: true, clientX: 100, clientY: 260 });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(0);
});

test('(d) simultaneous pointers on two DIFFERENT tiles record one event each (AC-05)', async ({
  page
}) => {
  const a = page.getByTestId('tile-mr-parking-dropoff');
  const b = page.getByTestId('tile-safe-car-dropoff');
  await a.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
  await b.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: false, bubbles: true });
  await a.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  await b.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(2);
  const providers = state.events.map((e) => e.provider_id).sort();
  expect(providers).toEqual(['mr-parking', 'safe-car']);
});

test('(g) simultaneous pointers on the TWO HALVES of one tile record one drop-off + one pick-up (AD-2)', async ({
  page
}) => {
  const drop = page.getByTestId('tile-mr-parking-dropoff');
  const pick = page.getByTestId('tile-mr-parking-pickup');
  await drop.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
  await pick.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: false, bubbles: true });
  await drop.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  await pick.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });

  const state = await getQueueState(page);
  expect(state.events).toHaveLength(2);
  const dirs = state.events
    .filter((e) => e.provider_id === 'mr-parking')
    .map((e) => e.direction)
    .sort();
  expect(dirs).toEqual(['dropoff', 'pickup']);
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('1');
  await expect(page.getByTestId('count-mr-parking-pickup')).toHaveText('1');
});

test.describe('real touch (CDP) — a scroll-swipe that STARTS on a half records ZERO events (L-0001)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a genuine touchStart+touchMove+touchEnd swipe on the drop-off half is not a tap', async ({
    page
  }) => {
    // L-0001: only a real CDP touch-swipe (not a synthetic pointer sequence)
    // catches a commit-on-pointerdown regression, so drive the Chrome DevTools
    // Protocol touch input directly.
    const half = page.getByTestId('tile-mr-parking-dropoff');
    const box = (await half.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY }]
    });
    // Drag well beyond the ~10px slop, as a finger scrolling the screen would.
    for (const dy of [30, 90, 160]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX, y: startY - dy }]
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const state = await getQueueState(page);
    expect(state.events).toHaveLength(0);
    await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('0');
  });
});

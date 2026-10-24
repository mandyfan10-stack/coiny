import { test, expect } from '@playwright/test';
const circumference = 2 * Math.PI * 88;
const fixture = '/tests/ui/video-note-progress-fixture.html';
async function ready(page) {
  await page.goto(fixture);
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate(async video => { video.pause(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}
test('ring moves on display frames with the actual video clock, preserving its appearance', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const video = document.querySelector('video');
    const ring = document.querySelector('.video-progress-ring-circle');
    video.currentTime = 0;
    video.playbackRate = .1;
    await video.play();
    const samples = [];
    for (let frame = 0; frame < 65; frame++) {
      await new Promise(requestAnimationFrame);
      samples.push({ offset: Number(ring.getAttribute('stroke-dashoffset')), time: video.currentTime });
    }
    video.pause();
    return { samples, duration: video.duration, radius: ring.getAttribute('r'), width: ring.getAttribute('stroke-width'),
      stroke: ring.getAttribute('stroke'), transition: getComputedStyle(ring).transitionDuration,
      size: document.querySelector('.round-video-wrapper').getBoundingClientRect().width };
  });
  expect(new Set(result.samples.map(s => s.offset)).size).toBeGreaterThan(20);
  const deltas = result.samples.slice(1).map((s, i) => result.samples[i].offset - s.offset);
  expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-.01);
  expect(Math.max(...deltas)).toBeLessThan(30);
  // Our sampling callback can run before the player's callback in the same
  // display frame. Allow that one frame of age, including dropped frames.
  for (const [index, sample] of result.samples.entries()) {
    const previousTime = index ? result.samples[index - 1].time : 0;
    expect(sample.offset).toBeGreaterThanOrEqual(circumference * (1 - sample.time / result.duration) - 5);
    expect(sample.offset).toBeLessThanOrEqual(circumference * (1 - previousTime / result.duration) + 5);
  }
  expect(result).toMatchObject({ radius: '88', width: '3', stroke: 'var(--accent-color)', transition: '0s', size: 180 });
});
test('pause, seek, ending and replay update immediately without a backwards transition', async ({ page }) => {
  await ready(page);
  await page.locator('video').evaluate(video => { video.currentTime = .25; });
  await expect.poll(() => page.locator('circle').evaluate(node => Number(node.getAttribute('stroke-dashoffset')))).toBeCloseTo(circumference / 2, 0);
  const paused = await page.locator('circle').getAttribute('stroke-dashoffset');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
  expect(await page.locator('circle').getAttribute('stroke-dashoffset')).toBe(paused);
  await page.locator('video').evaluate(async video => { video.playbackRate = 1; await video.play(); });
  await expect.poll(() => page.locator('video').evaluate(video => video.ended)).toBe(true);
  await expect.poll(() => page.locator('circle').evaluate(node => Number(node.getAttribute('stroke-dashoffset')))).toBeCloseTo(0, 1);
  await page.locator('video').evaluate(video => { video.playbackRate = .1; });
  await page.locator('.round-video-wrapper').click();
  await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(false);
  await expect.poll(() => page.locator('circle').evaluate(node => Number(node.getAttribute('stroke-dashoffset')))).toBeGreaterThan(circumference * .8);
});
test('buffering stops animation and unmount cancels pending ring updates', async ({ page }) => {
  await page.addInitScript(() => {
    const schedule = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set();
    window.__ringFrames = pending;
    window.requestAnimationFrame = callback => {
      const id = schedule(time => { pending.delete(id); callback(time); });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  });
  await ready(page);
  await page.evaluate(() => {
    const video = document.querySelector('video');
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('waiting'));
  });
  const frozen = await page.locator('circle').getAttribute('stroke-dashoffset');
  await expect.poll(() => page.evaluate(() => window.__ringFrames.size)).toBe(0);
  expect(await page.locator('circle').getAttribute('stroke-dashoffset')).toBe(frozen);
  await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('playing')));
  await expect.poll(() => page.evaluate(() => window.__ringFrames.size)).toBe(1);
  await page.getByRole('button', { name: 'Показать / скрыть' }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__ringFrames.size)).toBe(0);
});

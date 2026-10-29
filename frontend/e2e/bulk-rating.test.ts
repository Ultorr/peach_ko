import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { launch, layout, settle, VIEWPORTS, visit } from './harness.ts';

const evidence = process.env.PEACH_BULK_EVIDENCE || join('..', 'build', 'agent-verification', 'bulk-rating');
const snapshot = async (page: Page, name: string) => {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: false });
  const geometry = await layout(page);
  assert.ok(geometry.scrollWidth <= geometry.viewportWidth + 1, JSON.stringify(geometry));
};
const getJson = async (page: Page, path: string) => {
  const response = await page.request.get(new URL(path, page.url()).toString());
  assert.equal(response.status(), 200); return response.json();
};
async function applyRating(page: Page, stars: number) {
  await page.locator('[data-batch-action="rating"]').click();
  const dialog = page.locator('[data-bulk-rating]');
  await dialog.locator(`input[value="${stars * 20}"]`).check();
  await dialog.getByRole('button', { name: '별점 적용', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await settle(page, '#grid');
}

describe('folder and multiple video ratings', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });

  for (const viewport of VIEWPORTS) {
    it(`${viewport.name} selects folders, checks ranges and assigns or clears persisted ratings`, { timeout: 120_000 }, async () => {
      const opened = await visit(browser, '/?browse=folders&loc=local&thumb=0&sort=name', viewport, async page => {
        await page.addInitScript(() => localStorage.setItem('peach.settings.v1', JSON.stringify({ detailAutoplay: false, hoverDelaySeconds: 0 })));
      });
      const { page } = opened;
      page.setDefaultTimeout(15_000);
      const mediaRequests: string[] = [];
      const mediaObservations: Record<string, unknown>[] = [];
      const mediaProbes: Promise<void>[] = [];
      let phase = 'folder load and baseline';
      page.on('request', request => {
        if (request.resourceType() !== 'media') return;
        const url = request.url(), requestPhase = phase;
        mediaRequests.push(url);
        mediaProbes.push(page.evaluate(() => ({
          selecting: document.body.classList.contains('select-mode'),
          detailOpen: !!document.querySelector('#stage[open]'),
          hover: [...document.querySelectorAll<HTMLVideoElement>('video.hv')].map(video => ({
            id: video.closest('[data-id]')?.getAttribute('data-id'),
            src: video.getAttribute('src'), paused: video.paused,
          })),
        })).then(state => { mediaObservations.push({ url, phase: requestPhase, ...state }); },
          error => { mediaObservations.push({ url, phase: requestPhase, probeError: String(error) }); }));
      });
      try {
        const roots = await getJson(page, '/api/folders?loc=local');
        const root = roots.roots[0]; assert.ok(root);
        const address = `/?browse=folders&folder=${encodeURIComponent(root.id)}&loc=local&thumb=0&sort=name`;
        await page.goto(new URL(address, page.url()).toString());
        await page.locator('[data-folder-select]').waitFor();
        await settle(page, '#grid');
        await snapshot(page, `${viewport.name}-folder`);
        const all = await getJson(page, `/api/items?folder=${encodeURIComponent(root.id)}&thumb=0&limit=200&sort=name`);
        assert.ok(all.items.length >= 3);
        const baseline = new Map<number, { rating: number | null; play_count: number; play_seconds: number }>();
        for (const item of all.items) baseline.set(item.id, await getJson(page, `/api/item?id=${item.id}`));

        phase = 'card selection';
        await page.locator('#selectMode').click();
        const cards = page.locator('#grid [data-media-card][data-id]');
        const firstIds = await cards.evaluateAll(nodes => nodes.slice(0, 3).map(node => Number(node.getAttribute('data-id'))));
        assert.equal(firstIds.length, 3);
        await cards.nth(0).getByRole('checkbox').click();
        await cards.nth(2).getByRole('checkbox').click({ modifiers: ['Shift'] });
        assert.equal(await page.locator('#grid [data-media-card][data-selected]').count(), 3);
        await snapshot(page, `${viewport.name}-selected`);
        phase = 'card rating dialog';
        await page.locator('[data-batch-action="rating"]').click();
        const dialog = page.locator('[data-bulk-rating]');
        assert.equal(await dialog.getByRole('button', { name: '별점 적용', exact: true }).isDisabled(), true);
        await dialog.getByRole('radio', { name: '4점', exact: true }).check();
        await snapshot(page, `${viewport.name}-rating`);
        phase = 'card rating save and close';
        await dialog.getByRole('button', { name: '별점 적용', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        phase = 'verify card ratings';
        for (const item of all.items) {
          const saved = await getJson(page, `/api/item?id=${item.id}`);
          assert.equal(saved.rating, firstIds.includes(item.id) ? 80 : baseline.get(item.id)?.rating);
          assert.equal(saved.play_count, baseline.get(item.id)?.play_count);
          assert.equal(saved.play_seconds, baseline.get(item.id)?.play_seconds);
        }

        phase = 'direct folder selection';
        await page.locator('.folder-scope-row label').filter({ hasText: '하위 폴더 포함' }).click();
        assert.equal(await page.getByRole('checkbox', { name: '하위 폴더 포함', exact: true }).isChecked(), false);
        await settle(page, '#catalogFolderHeader');
        await page.locator('[data-folder-select]').click();
        await page.getByText('이 폴더에 선택할 영상이 없습니다.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-selection-dock]').count(), 0);
        phase = 'recursive folder selection';
        await page.locator('.folder-scope-row label').filter({ hasText: '하위 폴더 포함' }).click();
        assert.equal(await page.getByRole('checkbox', { name: '하위 폴더 포함', exact: true }).isChecked(), true);
        await settle(page, '#catalogFolderHeader');
        await page.locator('[data-folder-select]').click();
        await page.locator('[data-selection-dock]').waitFor();
        assert.match(await page.locator('[data-selection-dock] [role="status"]').innerText(), new RegExp(String(all.total)));
        phase = 'folder rating save and close';
        await applyRating(page, 2);
        for (const item of all.items) assert.equal((await getJson(page, `/api/item?id=${item.id}`)).rating, 40);

        phase = 'list selection';
        await page.getByRole('radio', { name: '목록', exact: true }).locator('xpath=ancestor::label').click();
        await page.locator('[data-catalog-row]').first().waitFor();
        const rows = page.locator('[data-catalog-row]');
        await rows.nth(0).locator('label').click();
        await rows.nth(2).locator('label').click({ modifiers: ['Shift'] });
        assert.equal(await page.locator('[data-catalog-row][data-board-selected]').count(), 3);
        await snapshot(page, `${viewport.name}-list`);
        phase = 'list rating save and close';
        await applyRating(page, 5);
        phase = 'folder clear rating';
        await page.locator('[data-folder-select]').click();
        await page.locator('[data-selection-dock]').waitFor();
        await applyRating(page, 0);
        for (const item of all.items) assert.equal((await getJson(page, `/api/item?id=${item.id}`)).rating, null);
        await Promise.all(mediaProbes);
        assert.deepEqual(mediaRequests, [], JSON.stringify({ mediaObservations }));
        assert.deepEqual(opened.problems, []);
        writeFileSync(join(evidence, `${viewport.name}-result.json`), JSON.stringify({ passed: true, videos: all.total,
          cardShift: 3, listShift: 3, recursive: true, directOnly: true, ratings: [4, 2, 5, 0], mediaRequests }, null, 2));
      } finally { await opened.close() }
    });
  }
});

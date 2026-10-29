import { afterEach, describe, expect, it, vi } from 'vitest';
import { folderVideoIds, saveVideoRatings } from '../src/bulk-rating';

afterEach(() => vi.unstubAllGlobals());

describe('folder video selection', () => {
  it('collects every page with recursion controlled explicitly', async () => {
    // Given: a folder larger than one API page.
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'http://test'); calls.push(url);
      const offset = Number(url.searchParams.get('offset'));
      const count = offset ? 1 : 200;
      return Response.json({ total: 201, items: Array.from({ length: count }, (_, n) => ({ id: offset + n + 1 })) });
    }));
    // When: direct children are selected.
    const ids = await folderVideoIds('folder-key', false, new AbortController().signal);
    // Then: pagination, scope and uncollapsed files are retained.
    expect(ids).toEqual(Array.from({ length: 201 }, (_, n) => n + 1));
    expect(calls.map(url => url.searchParams.get('offset'))).toEqual(['0', '200']);
    expect(calls.every(url => url.searchParams.get('folder') === 'folder-key'
      && url.searchParams.get('folder_recursive') === '0' && url.searchParams.get('thumb') === '0')).toBe(true);
  });

  it('rejects a changing folder instead of silently selecting fewer files', async () => {
    // Given: a page no longer contains the counted files.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ total: 2, items: [{ id: 1 }] })));
    // When / Then: no incomplete selection is returned.
    await expect(folderVideoIds('folder-key', true, new AbortController().signal)).rejects.toThrow();
  });
});

describe('bulk video ratings', () => {
  it('assigns a fixed score, skips nonvideo items and never posts playback', async () => {
    // Given: one video and one image.
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') { writes.push(JSON.parse(String(init.body))); return Response.json({ ok: true, rating: 80 }); }
      return Response.json({ id: path.endsWith('1') ? 1 : 2, medium: path.endsWith('1') ? 'video' : 'image' });
    }));
    const completed = new Set<number>(), skipped = new Set<number>();
    // When: four stars are assigned.
    await saveVideoRatings([1, 2], 80, new Set([1]), completed, skipped, () => {});
    // Then: only the video receives the exact score.
    expect(writes).toEqual([{ id: 1, kind: 'rate', value: 80 }]);
    expect([...completed]).toEqual([1]); expect([...skipped]).toEqual([2]);
  });

  it('retries only unfinished items and supports explicit rating removal', async () => {
    // Given: the second write fails once.
    const writes: number[] = []; let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json({ medium: 'video' });
      const body = JSON.parse(String(init.body)); writes.push(body.id);
      if (body.id === 2 && fail) { fail = false; return Response.json({ error: 'test failure' }, { status: 500 }); }
      expect(body.value).toBe(0); return Response.json({ ok: true, rating: null });
    }));
    const completed = new Set<number>(), skipped = new Set<number>();
    await expect(saveVideoRatings([1, 2, 3], 0, new Set([1, 2, 3]), completed, skipped, () => {})).rejects.toThrow();
    // When: the same operation is retried.
    await saveVideoRatings([1, 2, 3], 0, new Set([1, 2, 3]), completed, skipped, () => {});
    // Then: the saved first item is not written twice.
    expect(writes).toEqual([1, 2, 2, 3]); expect([...completed]).toEqual([1, 2, 3]);
  });

  it('rejects an invalid score before sending any request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(saveVideoRatings([1], 25, new Set([1]), new Set(), new Set(), () => {})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

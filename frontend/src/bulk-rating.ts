import { apiGet, apiSend } from './api';

class BulkRatingError extends Error {}

export async function folderVideoIds(folder: string, recursive: boolean, signal: AbortSignal): Promise<number[]> {
  if (!folder) throw new BulkRatingError('먼저 폴더를 선택하세요.');
  const ids = new Set<number>();
  const query = new URLSearchParams({ folder, folder_recursive: recursive ? '1' : '0',
    thumb: '0', sort: 'name', dir: 'asc', limit: '200' });
  let total = 0;
  for (let offset = 0; offset === 0 || offset < total; offset += 200) {
    query.set('offset', String(offset));
    const page = await apiGet<{ items: { id: number }[]; total: number }>(`/api/items?${query}`, signal);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || (offset && page.total !== total)) {
      throw new BulkRatingError('폴더 목록이 변경되었습니다. 다시 선택하세요.');
    }
    total = page.total;
    if (page.items.length !== Math.min(200, total - offset)) {
      throw new BulkRatingError('폴더 목록이 변경되었습니다. 다시 선택하세요.');
    }
    for (const item of page.items) ids.add(item.id);
  }
  if (ids.size !== total) throw new BulkRatingError('폴더 목록이 변경되었습니다. 다시 선택하세요.');
  return [...ids];
}

export async function saveVideoRatings(ids: readonly number[], value: number, videos: ReadonlySet<number>, completed: Set<number>,
  skipped: Set<number>, progress: () => void): Promise<void> {
  if (![0, 20, 40, 60, 80, 100].includes(value)) throw new BulkRatingError('별점은 1~5점 또는 해제로 지정하세요.');
  for (const id of new Set(ids)) {
    if (completed.has(id) || skipped.has(id)) continue;
    if (!videos.has(id)) skipped.add(id);
    else {
      await apiSend('/api/feedback', { id, kind: 'rate', value });
      completed.add(id);
    }
    progress();
  }
}

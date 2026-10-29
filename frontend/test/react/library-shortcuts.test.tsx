import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../src/react/query';
import { FavoriteButton, LibraryShortcuts } from '../../src/react/library-shortcuts/shortcut-controls';
import { favoriteHref, SHORTCUTS_KEY, type Shortcuts } from '../../src/react/library-shortcuts/library-shortcuts';
import { click, mount, pending, settle, submit, type } from './render';

notifyManager.setScheduler((notify) => notify());
afterEach(() => { queryClient.clear() });
const empty: Shortcuts = { favorites: [], filters: [] };

describe('我的收藏', () => {
  it('资料页的规范收藏状态不受旧身份缓存影响', async () => {
    queryClient.setQueryData(SHORTCUTS_KEY, { favorites: [
      { entity_id: 2, kind: 'performer', name: '旧人物' },
    ], filters: [] });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const host = await mount(<QueryClientProvider client={queryClient}>
      <FavoriteButton item={{ entity_id: 2, kind: 'performer', name: '新人物', favorite: false }} />
      <FavoriteButton item={{ entity_id: 1, kind: 'performer', name: '合并目标', favorite: true }} />
    </QueryClientProvider>);
    expect(host.querySelector('[aria-label="즐겨찾기新人物"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[aria-label="즐겨찾기 해제合并目标"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('等待收藏回执时保持可聚焦，回读后允许取消', async () => {
    queryClient.setQueryData(SHORTCUTS_KEY, empty);
    const answer = pending<unknown>();
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (!init?.body) return { ok: true, json: async () => empty };
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => calls.length === 1 ? answer.answer : empty };
    }));
    const host = await mount(<QueryClientProvider client={queryClient}>
      <FavoriteButton item={{ entity_id: 1, kind: 'studio', name: '厂牌' }} />
    </QueryClientProvider>);
    await click(host.querySelector('[aria-label="즐겨찾기厂牌"]'));
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await click(button);
    expect(calls).toHaveLength(1);
    await answer.release({ favorites: [{ key: 'entity:1', entity_id: 1, kind: 'studio', name: '厂牌' }], filters: [] });
    await settle();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await click(host.querySelector('[aria-label="즐겨찾기 해제厂牌"]'));
    await settle();
    expect(calls[1]).toMatchObject({ action: 'favorite', entity_id: 1, on: false });
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('保存当前条件后显示可应用链接并可删除', async () => {
    let data = empty;
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init?.body) {
        const body = JSON.parse(init.body); writes.push(body);
        data = body.action === 'save_filter' ? { favorites: [], filters: [{ id: 'one', name: body.name, href: body.href }] } : empty;
      }
      return { ok: true, json: async () => data };
    }));
    await mount(<QueryClientProvider client={queryClient}>
      <LibraryShortcuts currentHref={() => '/watch-later?loc=&tag=VR&jav=1'} />
    </QueryClientProvider>);
    await click(document.querySelector('[aria-label="내 즐겨찾기"]'));
    await settle();
    expect(document.querySelector('nav[aria-label="즐겨찾는 항목 목록"] a[href="/flagged"]')?.textContent).toBe('표시한 항목');
    expect(document.querySelector('nav[aria-label="즐겨찾는 항목 목록"] a[href="/watch-later"]')?.textContent).toBe('나중에 보기');
    expect(document.querySelector('form[aria-label="현재 필터 저장"]')).toBeNull();
    await click(document.querySelector('[role="tab"][aria-label="저장한 필터"]'));
    await type(document.querySelector('form[aria-label="현재 필터 저장"] input'), 'VR 待看');
    await submit(document.querySelector('form'));
    await settle();
    expect(writes[0]).toEqual({ action: 'save_filter', name: 'VR 待看', href: '/watch-later?loc=&tag=VR&jav=1' });
    const savedLink = () => [...document.querySelectorAll('a')].find(link => link.textContent === 'VR 待看');
    expect(savedLink()?.getAttribute('href')).toBe('/watch-later?loc=&tag=VR&jav=1');
    expect(savedLink()?.getAttribute('title')).toBeNull();
    await click(document.querySelector('[aria-label="필터 삭제:VR 待看"]'));
    await settle();
    expect(savedLink()).toBeUndefined();
  });

  it('收藏链接使用现有实体路由和编码后的标签', () => {
    expect(favoriteHref({ kind: 'studio', name: 'A/B' })).toBe('/studios/A%2FB');
    expect(favoriteHref({ kind: 'tag', name: 'A&B', entity_id: 67 })).toBe('/tags/67');
  });

  it('各类收藏显示可用图像并按名称筛选', async () => {
    const favorites = ['performer', 'creator', 'studio', 'series', 'agency', 'tag'].map((kind, index) =>
      ({ key: `entity:${index + 1}`, entity_id: index + 1, kind, name: `收藏 ${kind}`, image_url: `/test-image/${kind}` }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ favorites, filters: [] }) })));
    await mount(<QueryClientProvider client={queryClient}><LibraryShortcuts /></QueryClientProvider>);
    await click(document.querySelector('[aria-label="내 즐겨찾기"]'));
    await settle();
    expect(document.querySelectorAll('[data-shortcuts-avatar] img')).toHaveLength(6);
    expect(document.querySelector('[data-shortcuts-avatar] .ini')).toBeNull();
    await type(document.querySelector('input[aria-label="즐겨찾기 검색"]'), 'studio');
    expect(document.querySelectorAll('[data-shortcuts-row]')).toHaveLength(1);
    expect(document.querySelector('[data-shortcuts-row] a')?.getAttribute('href')).toBe('/studios/3');
    await type(document.querySelector('input[aria-label="즐겨찾기 검색"]'), 'missing');
    expect(document.querySelector('[data-empty-state] h3')?.textContent).toBe('일치하는 즐겨찾기가 없습니다');
  });
});

/* 数据管理页：顶上那排读数与入口，链接、资源同步和整理三件要在这页上做的事。
 *
 * 会写真实 ledger 或删盘上东西的那几步（删失效链接、资源同步清理、整理的执行
 * 与回滚）都必须先过确认弹层：这里既量「确认了才发」，也量「取消了一个字节都不发」。
 * 外观由 `frontend/e2e/design-*.test.ts` 读 `getComputedStyle` 断言；这里只看结构、文字与请求。 */
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as legacyUi from '@peach/legacy/ui';

import type { DataCleanupSection } from '../../src/react/bundle';
import { DataCleanupPage } from '../../src/react/data-cleanup/data-cleanup-page';
import { junkBreakdown, prefetchDataCleanup, reviewSummary } from '../../src/react/data-cleanup/data-cleanup';
import { LinkManager } from '../../src/react/data-cleanup/link-manager';
import type { LinkCheckState } from '../../src/react/data-cleanup/links';
import { OrganizeCard } from '../../src/react/data-cleanup/organize-card';
import type { OrganizeData } from '../../src/react/data-cleanup/organize';
import { OrphanRecordsCard } from '../../src/react/data-cleanup/orphan-records-card';
import type { OrphanRecordsData } from '../../src/react/data-cleanup/orphan-records';
import { ResourceSyncCard } from '../../src/react/data-cleanup/resource-sync-card';
import { hasResourceRoots, RESOURCE_SCAN_KEY, type ResourceScanState } from '../../src/react/data-cleanup/resource-sync';
import { IDLE_REPAIR } from '../../src/react/media-repair/media-repair';
import type { MediaSourcesData } from '../../src/react/media-sources';
import { queryClient } from '../../src/react/query';
import { buttonNamed, click, mount, settle, type } from './render';

afterEach(() => {
  queryClient.clear();
  localStorage.clear();
  sessionStorage.clear();
});
notifyManager.setScheduler((notify) => notify());

const FAIL = Symbol('fail');
/** 一条端点回非 2xx。 */
const failWith = (status: number, body: unknown = {}) => ({ [FAIL]: true, status, body });

type Route = unknown | ((body: unknown, method: string) => unknown);

/** 按路径应答。没造数据的路径回 404 并记下来，用例据此核对页面没去问不该问的端点。 */
function serve(routes: Record<string, Route>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unknown: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (!(path in routes)) {
      unknown.push(path);
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const route = routes[path];
    const answer = typeof route === 'function' ? (route as (b: unknown, m: string) => unknown)(body, method) : route;
    if (answer && typeof answer === 'object' && FAIL in answer) {
      const { status, body: payload } = answer as ReturnType<typeof failWith>;
      return { ok: false, status, json: async () => payload };
    }
    return { ok: true, status: 200, json: async () => answer };
  }));
  return {
    calls, unknown,
    posts: (path: string) => calls.filter((call) => call.path === path && call.method === 'POST').map((call) => call.body),
  };
}

type Confirmation = Parameters<typeof legacyUi.confirmModal>[0];

/** 确认弹层：`answer` 为真时替人点确认。两种情况都记下弹层上写的是什么。 */
function confirmWith(answer: boolean) {
  const seen: Confirmation[] = [];
  vi.spyOn(legacyUi, 'confirmModal').mockImplementation((async (options: Confirmation) => {
    seen.push(options);
    if (answer) await options.onConfirm?.();
    return { confirmed: answer };
  }) as typeof legacyUi.confirmModal);
  return seen;
}

const wrap = (element: ReactElement) => mount(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);

const withRoots: MediaSourcesData = {
  sources: [{ location: 'local', online: true, roots: ['R:\\media'] }, { location: '115', online: false, roots: ['B:\\'] },
    { location: 'online', online: true }],
};
const withoutRoots: MediaSourcesData = {
  sources: [{ location: 'local', online: true, roots: [] }, { location: 'online', online: true }],
};

const organizeIdle: OrganizeData = {
  status: 'idle', locations: [{ location: 'local', roots: ['R:\\media'] }],
  templates: { local: { file: '{number}', dir: '' } },
  presets: [{ label: '番号 + 标题', file: '{number}[ {title}]', dir: '{studio}' }],
  placeholders: [{ key: 'number', label: '番号' }, { key: 'title', label: '标题' }],
  last_batch: '',
};

/** 整页首屏要的每一条端点。 */
const pageRoutes = (sources: MediaSourcesData): Record<string, Route> => ({
  '/api/review?counts=1': { counts: { metadata_fields: 12, performer_avatars: 3, studio_logos: 2, creator_tags: 1 } },
  '/api/quality-goals?limit=200': { total: 7, items: [] },
  '/api/duplicates?limit=120': { total: 3, files: 8, reclaimable: 2 * 1073741824, groups: [] },
  '/api/ads?limit=1': { pending_total: 5, dismissed_total: 2, counts: { video: 4, url: 1 } },
  '/api/items?state=trash&limit=1': { total: 9, bytes: 3 * 1073741824 },
  '/api/sources': sources,
  '/api/library-processing': { status: 'idle' },
  '/api/media-repair': IDLE_REPAIR,
  '/api/libraries': { libraries: [] },
  '/api/organize': organizeIdle,
  '/api/links': { total: 0, entities: 0, by_kind: {}, top_hosts: [] },
  '/api/links/check': { status: 'idle', check_id: '', checked: 0, total: 0, gone: [], unclear: [], scope: '' },
  '/api/links/prune': { status: 'idle' },
  '/api/orphan-records': { total: 0, items: [] },
  '/api/resource-sync/scan': { status: 'idle', scan_id: '' },
  '/api/resource-sync/apply': { status: 'idle' },
});

async function openPage(sources: MediaSourcesData = withRoots, patch: Record<string, Route> = {}) {
  const server = serve({ ...pageRoutes(sources), ...patch });
  await prefetchDataCleanup(new AbortController().signal);
  const open = vi.fn<(section: DataCleanupSection) => void>();
  const host = await wrap(<DataCleanupPage toast={vi.fn()} failure={vi.fn()} open={open} />);
  await settle();
  return { host, open, server };
}

const entry = (host: ParentNode, section: DataCleanupSection) =>
  host.querySelector<HTMLButtonElement>(`[data-cleanup-go="${section}"]`);

describe('读数卡', () => {
  it('单面板分区的标题只在面板内显示', async () => {
    const { host } = await openPage();
    for (const id of ['link-manager', 'resource-sync']) {
      const section = host.querySelector(`#${id}`)!;
      const title = section.querySelector(`#${id}-title`)!;
      expect(title.tagName).toBe('H3');
      expect(title.parentElement).not.toBe(section);
      expect(section.querySelector(':scope > h2, :scope > h3')).toBeNull();
    }
  });

  it('复核列前三类、其余合成一项；垃圾分项只列有东西的类别', () => {
    expect(reviewSummary({ counts: { metadata_fields: 12, performer_avatars: 3, studio_logos: 2, creator_tags: 1 } }))
      .toEqual({ figure: '18 개 검토 대기', meta: '메타데이터 필드 12 · 배우 프로필 사진 3 · 스튜디오 로고 2 · 나머지 1' });
    expect(junkBreakdown({ pending_total: 5, dismissed_total: 2, counts: { video: 4, image: 0, url: 1 } }))
      .toBe('동영상 4 · URL 1 · 무시됨 2');
  });

  it('五张卡各读各的；点一张就换到那一页', async () => {
    const { host, open, server } = await openPage();
    expect(entry(host, 'review')?.textContent).toContain('18 개 검토 대기');
    expect(entry(host, 'quality')?.textContent).toContain('7 개 업그레이드 대기');
    expect(entry(host, 'duplicates')?.textContent).toContain('3 그룹 · 8 개 파일');
    expect(entry(host, 'duplicates')?.textContent).toContain('확보 가능한 공간 2.0 GB');
    expect(entry(host, 'ads')?.textContent).toContain('5 개 판별 대기');
    expect(entry(host, 'trash')?.textContent).toContain('9 개 항목이 휴지통에 있음');
    expect(entry(host, 'trash')?.textContent).toContain('사용 공간 3.0 GB');
    for (const section of ['review', 'quality', 'duplicates', 'ads', 'trash'] as const) await click(entry(host, section));
    expect(open.mock.calls.map(([section]) => section)).toEqual(['review', 'quality', 'duplicates', 'ads', 'trash']);
    expect(server.unknown).toEqual([]);
  });

  it('一张卡取不到只把那一张写成「读取失败」', async () => {
    const { host } = await openPage(withRoots, { '/api/review?counts=1': failWith(500) });
    expect(entry(host, 'review')?.textContent).toContain('읽기 실패');
    expect(entry(host, 'trash')?.textContent).toContain('9 개 항목이 휴지통에 있음');
  });

  it('回收站计数跟着侧栏选中的媒体库走', async () => {
    sessionStorage.setItem('peach.library', '网盘');
    const { server } = await openPage(withRoots, { '/api/items?state=trash&limit=1&library=%E7%BD%91%E7%9B%98': { total: 1, bytes: 0 } });
    expect(server.calls.map((call) => call.path)).toContain('/api/items?state=trash&limit=1&library=%E7%BD%91%E7%9B%98');
    expect(server.calls.map((call) => call.path)).not.toContain('/api/items?state=trash&limit=1');
  });
});

describe('资源同步', () => {
  it('只在有落盘来源配了根目录时出现，两份任务状态随首屏一起取回', async () => {
    expect(hasResourceRoots(withRoots)).toBe(true);
    expect(hasResourceRoots(withoutRoots)).toBe(false);
    const server = serve(pageRoutes(withRoots));
    await prefetchDataCleanup(new AbortController().signal);
    expect(server.calls.map((call) => call.path)).toEqual(expect.arrayContaining(['/api/resource-sync/scan', '/api/resource-sync/apply']));
    queryClient.clear();
    const shown = await openPage(withRoots);
    expect(shown.host.querySelector('#resource-sync')).not.toBeNull();
    queryClient.clear();
    const hidden = await openPage(withoutRoots);
    expect(hidden.host.querySelector('#resource-sync')).toBeNull();
    expect(hidden.server.calls.some((call) => call.path.startsWith('/api/resource-sync'))).toBe(false);
  });

  const scanned: ResourceScanState = {
    status: 'complete', scan_id: 'scan-7', missing: 4, empty: 3, unreadable: 0,
    cache: { files: 2, bytes: 1048576 * 5 },
    sources: [
      { location: 'local', online: true, total: 120, missing: 4, empty: 3, unreadable: 0 },
      { location: '115', online: false, total: 30, missing: 0, empty: 0, unreadable: 0 },
    ],
  };

  /** 执行那一条：POST 起任务，之后的 GET 回 `finished`；没起过就是空闲。 */
  const applyRoute = (finished: object) => {
    let started = false;
    return (_body: unknown, method: string) => {
      if (method === 'POST') {
        started = true;
        return { status: 'running', job_id: 'apply-1' };
      }
      return started ? { status: 'complete', job_id: 'apply-1', ...finished } : { status: 'idle' };
    };
  };

  it('扫完来源一行、待删三样一行；清理是危险确认，正文写明永久删除，确认后才发 apply', async () => {
    const seen = confirmWith(true);
    const toast = vi.fn();
    const server = serve({
      '/api/resource-sync/scan': scanned,
      '/api/resource-sync/apply': applyRoute({
        purged: 4, blocked: [], dirs_removed: 3, dir_errors: 0, cache_removed: 2, bytes_reclaimed: 1048576 * 5,
        cache_blocked: [],
      }),
      '/api/items?state=trash&limit=1': { total: 0, bytes: 0 },
    });
    const host = await wrap(<ResourceSyncCard toast={toast} />);
    await settle();
    expect(host.textContent).toContain('로컬 디스크');
    expect(host.textContent).toContain('오프라인으로 건너뜀');
    expect(host.textContent).toContain('컬렉션에 30 개');
    expect(host.textContent).toContain('빈 폴더 3 개');
    expect(host.textContent).toContain('영구 삭제 예정');
    expect(host.textContent).toContain('소스 루트 폴더 유지');
    expect(server.posts('/api/resource-sync/apply')).toEqual([]);
    await click(buttonNamed('유효하지 않은 항목 정리', host));
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.title).toBe('유효하지 않은 항목 정리');
    expect(seen[0]!.danger).toBe(true);
    expect(seen[0]!.body).toBe(
      '영구 삭제 대상: 디스크에 파일이 없는 기록 4 개(휴지통 포함), 빈 폴더:3 개,정리 대상: 2 개의 미사용 캐시. 소스 루트 폴더는 유지합니다.이 작업은 되돌릴 수 없습니다.');
    expect(server.posts('/api/resource-sync/apply')).toEqual([
      { confirm: true, clean_cache: true, scan_id: 'scan-7', background: true },
    ]);
    await settle();
    expect(toast).toHaveBeenCalledWith('유효하지 않은 항목을 정리했습니다');
    expect(host.textContent).toContain('영구 삭제 완료: 4 개의 유효하지 않은 기록과 3 개의 빈 폴더,정리 완료: 2 개 캐시, 확보 공간 5 MB。');
  });

  it('其余来源仍在扫描时显示已确认来源，任务失败也保留这些结果', async () => {
    const state = { status: 'running', scan_id: 'scan-partial', completed_sources: 1, total_sources: 2,
      sources: [scanned.sources![0]!] };
    serve({ '/api/resource-sync/scan': state, '/api/resource-sync/apply': { status: 'idle' } });
    const host = await wrap(<ResourceSyncCard toast={vi.fn()} />);
    await settle();
    expect(host.textContent).toContain('로컬 디스크');
    expect(host.textContent).toContain('빈 폴더 3 개');
    expect(buttonNamed('유효하지 않은 항목 정리', host)).toBeNull();
    expect(host.textContent).not.toContain('정리 가능한 캐시');
    await act(async () => { queryClient.setQueryData(RESOURCE_SCAN_KEY, {
      ...state, status: 'failed', error: '第二个来源无法读取',
    }); });
    expect(host.textContent).toContain('로컬 디스크');
    expect(host.textContent).toContain('第二个来源无法读取');
  });

  it('带个人记录的单列一档：读数卡与确认框分开报删除和标为已消失的条数，结果单报接回的', async () => {
    const seen = confirmWith(true);
    serve({
      '/api/resource-sync/scan': {
        ...scanned, purge: 3, vanish: 2,
        sources: [{ ...scanned.sources![0]!, vanish: 2 }, scanned.sources![1]!],
      },
      '/api/resource-sync/apply': applyRoute({
        purged: 3, vanished: 1, reattached: 1, blocked: [], dirs_removed: 3, dir_errors: 0, cache_removed: 2,
        bytes_reclaimed: 0, cache_blocked: [],
      }),
      '/api/items?state=trash&limit=1': { total: 0, bytes: 0 },
    });
    const host = await wrap(<ResourceSyncCard toast={vi.fn()} />);
    await settle();
    expect(host.textContent).toContain('파일 없음으로 표시 예정');
    expect(host.textContent).toContain('2 개 항목에 개인 기록 있음');
    await click(buttonNamed('유효하지 않은 항목 정리', host));
    await settle();
    expect(seen[0]!.body).toBe(
      '영구 삭제 대상: 디스크에 파일이 없는 기록 3 개(휴지통 포함), 빈 폴더:3 개,정리 대상: 2 개의 미사용 캐시. 소스 루트 폴더는 유지합니다.'
      + '이 삭제 및 정리 작업은 되돌릴 수 없습니다.2 개 항목은 개인 기록을 유지하며 파일 없음으로 표시합니다. 연결되지 않은 기록에서 새 파일에 연결하거나 영구 삭제할 수 있습니다.');
    await settle();
    expect(host.textContent).toContain(
      '1 개 항목은 개인 기록을 유지하며 파일 없음으로 표시했습니다. 연결되지 않은 기록에서 처리할 수 있습니다.1 개 항목의 기록을 라이브러리의 다른 버전에 연결했습니다.');
  });

  it('复核时发现文件还在、目录删不掉的几样留在原地：报警告档，结果条写部分完成', async () => {
    confirmWith(true);
    const toast = vi.fn();
    serve({
      '/api/resource-sync/scan': scanned,
      '/api/resource-sync/apply': applyRoute({
        purged: 3, blocked: [{ id: 9, name: '回来了.mp4', reason: 'present' }], dirs_removed: 2, dir_errors: 1,
        cache_removed: 2, bytes_reclaimed: 0, cache_blocked: [],
      }),
      '/api/items?state=trash&limit=1': { total: 0, bytes: 0 },
    });
    const host = await wrap(<ResourceSyncCard toast={toast} />);
    await settle();
    await click(buttonNamed('유효하지 않은 항목 정리', host));
    await settle();
    await settle();
    expect(toast).toHaveBeenCalledWith('완료 7 개 항목,2 개 항목 미처리', { warning: true });
    expect(host.textContent).toContain('일부 완료');
    expect(host.textContent).toContain('1 개 기록은 삭제하지 않았습니다(「回来了.mp4」），1 개 폴더 미삭제. 다시 확인한 뒤 재시도할 수 있습니다.');
  });

  it('取消确认就不发 apply', async () => {
    confirmWith(false);
    const server = serve({ '/api/resource-sync/scan': scanned, '/api/resource-sync/apply': { status: 'idle' } });
    const host = await wrap(<ResourceSyncCard toast={vi.fn()} />);
    await settle();
    await click(buttonNamed('유효하지 않은 항목 정리', host));
    await settle();
    expect(server.posts('/api/resource-sync/apply')).toEqual([]);
  });

  it('没有要清的东西时不给清理键，只说一句', async () => {
    serve({
      '/api/resource-sync/scan': { ...scanned, missing: 0, empty: 0, cache: { files: 0, bytes: 0 } },
      '/api/resource-sync/apply': { status: 'idle' },
    });
    const host = await wrap(<ResourceSyncCard toast={vi.fn()} />);
    await settle();
    expect(buttonNamed('유효하지 않은 항목 정리', host)).toBeNull();
    expect(host.textContent).toContain('접근 가능한 소스를 확인했습니다. 정리할 기록, 빈 폴더 또는 캐시가 없습니다.');
  });

  it('只有空文件夹要删时也给清理键', async () => {
    serve({
      '/api/resource-sync/scan': { ...scanned, missing: 0, empty: 2, cache: { files: 0, bytes: 0 } },
      '/api/resource-sync/apply': { status: 'idle' },
    });
    const host = await wrap(<ResourceSyncCard toast={vi.fn()} />);
    await settle();
    expect(buttonNamed('유효하지 않은 항목 정리', host)).not.toBeNull();
  });
});

describe('链接管理', () => {
  const row = (id: number, patch: Partial<LinkCheckState['gone'][number]> = {}) => ({
    id, entity: `女优 ${id}`, link_kind: 'official', label: '官网', url: `https://example.com/talent/${id}`, note: '404', ...patch,
  });
  const checked: LinkCheckState = {
    status: 'complete', check_id: 'check-3', checked: 3, total: 3, scope: 'all',
    gone: [row(1)], unclear: [row(2, { note: '403', link_kind: 'social' }), row(3, { note: '500' })],
  };
  const stats = {
    total: 719, entities: 210, by_kind: { official: 224, social: 373, catalog: 100, source_reference: 22 },
    top_hosts: [['x.com', 300], ['instagram.com', 70], ['linktr.ee', 3], ['tiktok.com', 1]],
  };

  it('每一类链接各占一格，类型用界面上的名字，主要站点只列前三', async () => {
    serve({ '/api/links': stats, '/api/links/check': { ...checked, status: 'idle' }, '/api/links/prune': { status: 'idle' } });
    const host = await wrap(<LinkManager />);
    await settle();
    const cells = [...host.querySelectorAll('.link-stat-grid > div')].map((cell) => cell.textContent);
    expect(cells).toEqual([
      '전체 링크 수719연결된 대상: 210 개의 배우, 제작사 및 시리즈', '공식 사이트/소속사224', '소셜 계정373', '항목 정보 사이트100', '정보 출처22',
    ]);
    expect(host.textContent).toContain('x.com 300 · instagram.com 70 · linktr.ee 3');
    expect(host.textContent).not.toContain('tiktok.com');
  });

  it('失效与未访问成功分两张表；删除是危险确认，确认了才带着这一趟的检查号发', async () => {
    const seen = confirmWith(true);
    let started = false;
    const server = serve({
      '/api/links': stats, '/api/links/check': checked,
      '/api/links/prune': (_body: unknown, method: string) => {
        if (method === 'POST') started = true;
        return started ? { ok: true, status: 'running', job_id: 'prune-1' } : { status: 'idle' };
      },
    });
    const host = await wrap(<LinkManager />);
    await settle();
    expect(host.querySelector('[aria-label="유효하지 않은 주소"]')?.textContent).toContain('女优 1');
    expect(host.querySelector('[aria-label="이번에 접속하지 못함"]')?.textContent).toContain('소셜 계정');
    await click(buttonNamed('삭제: 1 개의 유효하지 않은 링크', host));
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.danger).toBe(true);
    expect(seen[0]!.body).toBe('삭제 대상: 1 개의 유효하지 않은 링크. 삭제 전에 다시 확인하며, 삭제 후에는 복구할 수 없습니다.');
    expect(server.posts('/api/links/prune')).toEqual([{ confirm: true, check_id: 'check-3', background: true }]);
  });

  it('取消确认就不发删除', async () => {
    confirmWith(false);
    const server = serve({ '/api/links': stats, '/api/links/check': checked, '/api/links/prune': { status: 'idle' } });
    const host = await wrap(<LinkManager />);
    await settle();
    await click(buttonNamed('삭제: 1 개의 유효하지 않은 링크', host));
    await settle();
    expect(server.posts('/api/links/prune')).toEqual([]);
  });

  it('「全部重试」只重验未访问成功的那几条，带上这一趟的检查号', async () => {
    const server = serve({
      '/api/links': stats,
      '/api/links/check': (body: { status_only?: boolean }) => (body.status_only
        ? checked
        : { ...checked, status: 'running', scope: 'retry', checked: 0, total: 2 }),
      '/api/links/prune': { status: 'idle' },
    });
    const host = await wrap(<LinkManager />);
    await settle();
    await click(buttonNamed('모두 다시 시도(2）', host));
    await settle();
    expect(server.posts('/api/links/check').filter((body) => !(body as { status_only?: boolean }).status_only))
      .toEqual([{ retry: [2, 3], check_id: 'check-3' }]);
  });

  it('服务端拒绝时回 200 加 ok:false，照样当失败说出来', async () => {
    serve({
      '/api/links': stats,
      '/api/links/check': (body: { status_only?: boolean }) => (body.status_only
        ? { ...checked, status: 'idle' }
        : { ok: false, error: '清单已过期，请重新检查' }),
      '/api/links/prune': { status: 'idle' },
    });
    const host = await wrap(<LinkManager />);
    await settle();
    await click(buttonNamed('깨진 링크 확인', host));
    await settle();
    expect(host.textContent).toContain('清单已过期，请重新检查');
  });
});

describe('孤儿记录', () => {
  const orphans: OrphanRecordsData = {
    total: 2,
    items: [
      {
        id: 7, name: 'ABC-123.mp4', code: 'ABC-123', location: 'local', duration: 3600, size: 10,
        vanished_at: 200, has_thumb: true, records: { asset_preference: 1, activity_event: 3, rating: 4, play_count: 2 },
        candidates: [
          { id: 9, location: 'local', name: 'ABC-123.mkv', duration: 3590, size: 20 },
          { id: 10, location: 'local', name: 'abc-123.mp4', duration: 1800, size: 5 },
        ],
      },
      {
        id: 12, name: '海边.mp4', code: '', location: 'local', duration: 600, size: 10,
        vanished_at: 100, has_thumb: false, records: { watch_queue: 1, last_played: 1 }, candidates: [],
      },
    ],
  };

  it('没有已消失的作品时整块不出现', async () => {
    const { host, server } = await openPage();
    expect(host.querySelector('#orphan-records')).toBeNull();
    expect(server.calls.map((call) => call.path)).toContain('/api/orphan-records');
  });

  it('每条列出带的记录与候选文件；没有候选的只给彻底删除', async () => {
    serve({ '/api/orphan-records': orphans });
    const host = await wrap(<OrphanRecordsCard toast={vi.fn()} />);
    await settle();
    const rows = [...host.querySelectorAll('[aria-label="파일이 사라진 항목"] tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('좋아요 및 이유 1 · 시청 기록 3 · 평점 4 · 재생 2 회');
    expect(rows[0]!.textContent).toContain('ABC-123.mkv · 60 분');
    expect(rows[0]!.querySelector('img')?.getAttribute('src')).toBe('/thumb?id=7&c=4');
    expect(rows[1]!.textContent).toContain('나중에 보기 1 · 재생 이력 있음');
    expect(rows[1]!.textContent).toContain('품번이나 파일 이름이 일치하는 파일이 없습니다');
    expect(buttonNamed('이 파일에 연결', rows[1]!)).toBeFalsy();
    expect(buttonNamed('영구 삭제', rows[1]!)).toBeTruthy();
  });

  it('接到这个文件直接发，目标默认是时长最接近的那个', async () => {
    const server = serve({ '/api/orphan-records': orphans, '/api/orphan-records/attach': { ok: true, batch: 'user:reattach@1' } });
    const toast = vi.fn();
    const host = await wrap(<OrphanRecordsCard toast={toast} />);
    await settle();
    await click(buttonNamed('이 파일에 연결', host));
    await settle();
    expect(server.posts('/api/orphan-records/attach')).toEqual([{ id: 7, target: 9 }]);
    expect(toast).toHaveBeenCalledWith('기록을 새 파일에 연결했습니다. 작업 묶음 user:reattach@1');
  });

  /** 点第二条的「彻底删除」，交回弹层上写的与发出去的批量请求。 */
  async function purgeSecond(answer: boolean) {
    const seen = confirmWith(answer);
    const server = serve({ '/api/orphan-records': orphans, '/api/batch': { ok: true, purged: 1, blocked: [] } });
    const host = await wrap(<OrphanRecordsCard toast={vi.fn()} />);
    await settle();
    await click(buttonNamed('영구 삭제', host.querySelectorAll('[aria-label="파일이 사라진 항목"] tbody tr')[1]!));
    await settle();
    return { seen, posts: server.posts('/api/batch') };
  }

  it('彻底删除是危险确认，正文写明不可撤销，确认了才发批量删除', async () => {
    const { seen, posts } = await purgeSecond(true);
    expect(seen[0]!.danger).toBe(true);
    expect(seen[0]!.body).toBe('삭제 대상:「海边.mp4」 항목과 연결된 기록(나중에 보기 1 · 재생 이력 있음). 이 작업은 되돌릴 수 없습니다.');
    expect(posts).toEqual([{ ids: [12], operation: 'delete' }]);
  });

  it('取消确认就不发删除', async () => {
    expect((await purgeSecond(false)).posts).toEqual([]);
  });

  it('批量删除覆盖跨页选择，取消确认不发请求，文件恢复时显示保留数量', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({ ...orphans.items[1]!, id: index + 30, name: `作品 ${index}` }));
    const server = serve({ '/api/orphan-records': { total: items.length, items },
      '/api/batch': { ok: true, purged: 1, blocked: [50] } });
    const toast = vi.fn();
    const host = await wrap(<OrphanRecordsCard toast={toast} />);
    await settle();
    await click(host.querySelector('input[aria-label="선택: 作品 0"]'));
    await click(buttonNamed('다음 페이지', host));
    await click(host.querySelector('input[aria-label="선택: 作品 20"]'));
    confirmWith(false);
    await click(buttonNamed('선택한 기록 영구 삭제(2）', host));
    expect(server.posts('/api/batch')).toEqual([]);
    const seen = confirmWith(true);
    await click(buttonNamed('선택한 기록 영구 삭제(2）', host));
    await settle();
    expect(seen[0]!.items).toEqual(['作品 0', '作品 20']);
    expect(server.posts('/api/batch')).toEqual([{ ids: [30, 50], operation: 'delete' }]);
    expect(toast).toHaveBeenCalledWith('영구 삭제됨 1 개 기록，1 개 파일이 복원되어 삭제하지 않았습니다');
  });
});

describe('整理', () => {
  const plan = {
    counts: { change: 2, unchanged: 5 }, reasons: { 缺番号: 1 }, truncated: false,
    rows: [
      { current_path: 'R:\\media\\abc001.mp4', target_path: 'R:\\media\\S1\\ABC-001.mp4', action: 'move' },
      { current_path: 'R:\\media\\abc002.mp4', target_path: 'R:\\media\\S1\\ABC-002.mp4', action: 'move' },
    ],
  };

  function organizeServer(data: OrganizeData = organizeIdle) {
    return serve({
      '/api/organize': { ...data, status: 'running', job_id: 'org-1' },
      '/api/organize/preview': plan,
      '/api/organize/apply': { status: 'running', job_id: 'org-1' },
      '/api/organize/rollback': { status: 'running', job_id: 'org-2' },
      '/api/settings': { ok: true },
    });
  }

  it('模板框跟着存下的模板走；预览发的是这一格的来源与模板，预览不存模板', async () => {
    const server = organizeServer();
    queryClient.setQueryData(['organize'], organizeIdle);
    const host = await wrap(<OrganizeCard toast={vi.fn()} failure={vi.fn()} />);
    const file = host.querySelector<HTMLInputElement>('input[placeholder="{number}[ {title}]"]');
    expect(file?.value).toBe('{number}');
    await type(file, ' {number} {title} ');
    await click(buttonNamed('미리 보기', host));
    await settle();
    expect(server.posts('/api/organize/preview')).toEqual([
      { location: 'local', file_template: '{number} {title}', dir_template: '' },
    ]);
    expect(server.posts('/api/settings')).toEqual([]);
    expect(host.textContent).toContain('2 개 파일의 이름이나 위치를 변경하며,5 개는 이미 대상 이름과 일치합니다; 건너뜀 缺番号 1。');
    expect(host.textContent).toContain('ABC-001.mp4');
  });

  it('执行先确认，确认了才发 apply，起跑后存下这次的模板', async () => {
    const seen = confirmWith(true);
    const server = organizeServer();
    queryClient.setQueryData(['organize'], organizeIdle);
    const host = await wrap(<OrganizeCard toast={vi.fn()} failure={vi.fn()} />);
    expect(buttonNamed('정리 실행', host)).toBeNull();
    await click(buttonNamed('미리 보기', host));
    await settle();
    await click(buttonNamed('정리 실행', host));
    await settle();
    expect(seen.map((options) => options.title)).toEqual(['템플릿에 따라 파일 정리']);
    expect(seen[0]!.body).toContain('「로컬」의 파일 이름과 폴더');
    expect(server.posts('/api/organize/apply')).toEqual([
      { location: 'local', file_template: '{number}', dir_template: '', confirm: true },
    ]);
    expect(server.posts('/api/settings')).toEqual([
      { organizeTemplates: { local: { file: '{number}', dir: '' } } },
    ]);
  });

  it('有上一批才给回滚；回滚也先确认，取消就不发', async () => {
    const seen = confirmWith(false);
    const server = organizeServer({ ...organizeIdle, last_batch: 'batch-9' });
    queryClient.setQueryData(['organize'], { ...organizeIdle, last_batch: 'batch-9' });
    const host = await wrap(<OrganizeCard toast={vi.fn()} failure={vi.fn()} />);
    await click(buttonNamed('이전 작업 되돌리기', host));
    await settle();
    expect(seen.map((options) => options.title)).toEqual(['이전 정리 작업 되돌리기']);
    expect(server.posts('/api/organize/rollback')).toEqual([]);
    expect(server.posts('/api/organize/apply')).toEqual([]);

    queryClient.clear();
    queryClient.setQueryData(['organize'], organizeIdle);
    const fresh = await wrap(<OrganizeCard toast={vi.fn()} failure={vi.fn()} />);
    expect(buttonNamed('이전 작업 되돌리기', fresh)).toBeNull();
  });

  it('回滚确认了才发，请求体只有 confirm', async () => {
    confirmWith(true);
    const server = organizeServer({ ...organizeIdle, last_batch: 'batch-9' });
    queryClient.setQueryData(['organize'], { ...organizeIdle, last_batch: 'batch-9' });
    const host = await wrap(<OrganizeCard toast={vi.fn()} failure={vi.fn()} />);
    await click(buttonNamed('이전 작업 되돌리기', host));
    await settle();
    expect(server.posts('/api/organize/rollback')).toEqual([{ confirm: true }]);
  });
});

/* 统计页的行为：一屏读的是不是同一份数、四张卡当页签切到哪一层、几个空态去哪、
 * 点内容标签交回给壳的是哪个键、图表的分档怎么折算。
 *
 * 外观（卡片间距、阴影）是设计决定，由 `frontend/e2e/design-*.test.ts` 读
 * `getComputedStyle` 断言；这里只看结构、文字与请求。Recharts 在这里量不到容器尺寸，
 * 画不出图形本身，图的读数从图例、页头与纯函数上验。 */
import { act } from 'react';
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MEDIA_SOURCE_ICONS } from '@peach/legacy/ui';

import { queryClient } from '../../src/react/query';
import { shortCount } from '../../src/react/charts/bar-card';
import { categoryAxisWidth, fitLabel, labelWidth } from '../../src/react/charts/chart-card';
import {
  fmtCount, lengthRows, mediumRows, percentOf, percentText, playedFor, prefetchStats, radialArc,
  radialBarSize, radialCeiling, radialSlices, replayRows, STATS_URL, watchNote, type StatsData,
} from '../../src/react/stats/stats';
import { StatsPage } from '../../src/react/stats/stats-page';

import { buttonNamed, click, mount, mountRoot } from './render';

// 客户端是模块级的单例（所有 React 根共用一个），用例之间不清就互相喂数据。
afterEach(() => queryClient.clear());

/* Query 派发更新用的是它自己抓住的那个真 `setTimeout(0)`，假时钟推不动它：推完时钟
   断言到的还是上一帧的 DOM。用例里改成当场派发。 */
notifyManager.setScheduler((notify) => notify());

const payload = (overrides: Partial<StatsData> = {}): StatsData => ({
  by_loc: [{ k: 'local', n: 3, bytes: 3221225472, videos: 3 },
    { k: '115', n: 1, bytes: 1073741824, videos: 1 }],
  by_medium: [{ k: 'video', n: 4, bytes: 4294967296 }, { k: 'image', n: 6, bytes: 1048576 }],
  by_library: [{ k: 'main', name: '主库', icon: 'film', videos: 4, bytes: 4294967296 }],
  by_length: [{ k: '速食', n: 1 }, { k: '短', n: 3 }, { k: '中', n: 0 }, { k: '长', n: 0 }],
  by_quality: [{ k: '4K', n: 0 }, { k: '2K', n: 0 }, { k: '1080P', n: 4 }, { k: '720P', n: 0 }, { k: '低画质', n: 0 }],
  play_activity: {
    timezone: 'UTC+08:00',
    days: [{ date: '2026-09-20', count: 1 }, { date: '2026-09-22', count: 1 }],
    hours: [{ weekday: 0, hour: 23, count: 1 }, { weekday: 6, hour: 8, count: 1 }],
  },
  replays: [{ k: 1, n: 1 }, { k: 3, n: 1 }],
  attribution: { videos: 4, creator: 3, code: 2, studio: 1, thumb: 4, duration: 4 },
  tag_source: [{ k: 'javdb', n: 12, assets: 3 }],
  tag_cov: 2,
  top_tags: [{ k: 'tag:a', n: 9, cat: 'genre' }, { k: 'tag:b', n: 4, cat: 'genre' }],
  consumption: {
    played: 2, library_played: 1, online_played: 1, play_seconds: 7200,
    o_total: 5, liked: 1, dislike: 1, seen: 2, trash: 0, skimmed: 1,
  },
  recent: [{
    id: 42, name: 'one.mp4', creator: '甲', play_seconds: 600,
    duration: 1200, max_reached: 0.9, o_count: 0, kind: 'library',
  }],
  storage_volumes: [{
    kind: 'media', label: 'R:', root: 'R:\\media', online: true,
    free: 1073741824, used: 3221225472, total: 4294967296,
  }],
  storage_summary: { volumes: 1, online: 1, measured: 1, free: 1073741824, used: 3221225472, total: 4294967296 },
  ...overrides,
});

/** 遗留层交出来的那几个助手，换成可辨认的最小实现。 */
const legacyProps = () => ({
  tagLabel: (key: string) => `标签 ${key}`,
  onTag: vi.fn<(key: string) => void>(),
  openMediaSettings: vi.fn<() => void>(),
  configurable: true,
});

/** 依次回这几份数据，最后一份之后一直回它。`null` 那一份回 500。 */
function serve(...responses: (StatsData | null)[]) {
  let at = 0;
  const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => {
    const body = responses[Math.min(at, responses.length - 1)] ?? null;
    at += 1;
    return body
      ? { ok: true, status: 200, json: async () => body }
      : { ok: false, status: 500, json: async () => ({ message: '账本当前只能浏览' }) };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

/** 走完真实的首屏路径：先 prefetch 落进缓存，再挂载。 */
async function open(data: StatsData | null = payload(), props = legacyProps()) {
  const fetcher = serve(data);
  await prefetchStats(new AbortController().signal).catch(() => {});
  const mounted = await mountRoot(
    <QueryClientProvider client={queryClient}><StatsPage {...props} /></QueryClientProvider>);
  return { fetcher, props, ...mounted };
}

const tabNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[role=tab]')].find((tab) => tab.textContent?.includes(name)) ?? null;

it('整页一个请求：四张卡和下面三个面板读的是同一份快照', async () => {
  const { fetcher, host } = await open();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(STATS_URL);
  expect(host.querySelectorAll('[role=tablist]')).toHaveLength(2);
  expect([...host.querySelectorAll('[role=tablist]')[0]!.querySelectorAll('[role=tab]')]
    .map((tab) => tab.querySelector('b')?.textContent))
    .toEqual(['4', '2', '50%', '1 개 볼륨']);
});

it('抬头那一句用遗留层同一套体积口径', async () => {
  const { host } = await open();
  expect(host.querySelector('p')?.textContent).toBe('원장의 현재 스냅샷 · 4 개 동영상 · 4.0 GB');
});

it('四张卡就是页签：点「看过」换到看过那一层，其余的收起来', async () => {
  const { host } = await open();
  await click(tabNamed(host, '시청함'));
  expect(tabNamed(host, '시청함')?.getAttribute('aria-selected')).toBe('true');
  expect(tabNamed(host, '컬렉션 동영상')?.getAttribute('aria-selected')).toBe('false');
  const panel = host.querySelector('[role=tabpanel]')!;
  expect(panel.textContent).toContain('개 항목에 재생 기록 있음');
  expect(panel.textContent).toContain('오르가슴 횟수');
  expect(panel.textContent).not.toContain('프레임 추출 완료');
});

/** 库存那一层的两张径向图：图形那一块以图的标题为名。 */
const radialCharts = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('[role=tabpanel] div[role=img]')];

it('库存那一层每个来源一圈，图例用来源的界面名称', async () => {
  const { host } = await open();
  const charts = radialCharts(host);
  expect(charts.map((chart) => chart.getAttribute('aria-label'))).toEqual(['클라우드 및 로컬', '미디어 라이브러리']);
  const tiles = [...charts[0]!.closest('section')!.querySelectorAll('button')];
  expect(tiles.map((tile) => tile.querySelector('span')?.textContent)).toEqual(['로컬', '115']);
  expect(tiles.map((tile) => tile.querySelector('b')?.textContent)).toEqual(['3', '1']);
  expect(tiles[1]!.querySelector('svg use')?.getAttribute('href')).toBe(`#i-${MEDIA_SOURCE_ICONS['115']}`);
  expect(charts[1]!.closest('section')!.querySelector('button svg use')?.getAttribute('href')).toBe('#i-film');
});

it('满圈是最长那段的 1.1 倍，圈数越多每圈越细', () => {
  expect(radialCeiling([10, 5])).toBeCloseTo(11);
  expect(radialCeiling([])).toBeCloseTo(1.1);
  expect([2, 12, 40].map(radialBarSize)).toEqual([14, 8, 4]);
});

it('点图例把那一段钉住，读数跟着换；再点一次放开', async () => {
  const { host } = await open();
  const card = radialCharts(host)[0]!.closest('section')!;
  const tile = [...card.querySelectorAll('button')].find((button) => button.textContent?.startsWith('115'))!;
  await click(tile);
  expect(tile.getAttribute('aria-pressed')).toBe('true');
  expect(card.querySelector('h3')?.textContent).toBe('115');
  expect(card.querySelector('h3 svg use')?.getAttribute('href')).toBe(`#i-${MEDIA_SOURCE_ICONS['115']}`);
  expect(card.querySelector('header b')?.textContent).toBe('1');
  await click(tile);
  expect(tile.getAttribute('aria-pressed')).toBe('false');
  expect(card.querySelector('h3')?.textContent).toBe('클라우드 및 로컬');
});

it('库存那一层按时长、画质、文件类型各出一张分布图，页头读合计', async () => {
  const { host } = await open();
  const panel = host.querySelector('[role=tabpanel]')!;
  const bars = [...panel.querySelectorAll('section[aria-label]')];
  expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.querySelector('header b')?.textContent]))
    .toEqual([['재생 시간', '4'], ['화질', '4'], ['파일 형식', '10']]);
});

it('分布图的分档：时长换成分钟区间，文件类型多的在前，播放次数长尾并档', () => {
  expect(lengthRows([{ k: '速食', n: 1 }, { k: '长', n: 2 }, { k: '超长', n: 3 }]))
    .toEqual([{ name: '5분 미만', value: 1 }, { name: '40분 초과', value: 2 }, { name: '超长', value: 3 }]);
  expect(mediumRows([{ k: 'video', n: 4, bytes: 0 }, { k: 'account', n: 9, bytes: 0 }, { k: 'x', n: 1, bytes: 0 }]))
    .toEqual([{ name: '계정', value: 9 }, { name: '동영상', value: 4 }, { name: 'x', value: 1 }]);
  expect(replayRows([{ k: 1, n: 52 }, { k: 2, n: 13 }, { k: 4, n: 6 }, { k: 7, n: 1 }, { k: 9, n: 1 }, { k: 12, n: 2 }]))
    .toEqual([
      { name: '1', value: 52 }, { name: '2', value: 13 }, { name: '3', value: 0 },
      { name: '4', value: 6 }, { name: '5', value: 0 }, { name: '6–9', value: 2 },
      { name: '≥10', value: 2 },
    ]);
});

it('看过那一层有播放时间的两张热力图，指到一格读数换成那一格', async () => {
  const { host } = await open();
  await click(tabNamed(host, '시청함'));
  const panel = host.querySelector('[role=tabpanel]')!;
  const heats = [...panel.querySelectorAll('svg[role=img]')];
  expect(heats.map((heat) => heat.getAttribute('aria-label'))).toEqual(['재생 시간', '일별 재생']);
  const card = heats[0]!.closest('section')!;
  expect(card.querySelector('header b')?.textContent).toBe('2');
  expect(card.querySelector('footer')?.textContent).toContain('UTC+08:00');
  const cell = card.querySelector<SVGRectElement>('rect[aria-label="월요일 23:00，1 개 항목"]')!;
  await act(async () => { cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
  expect(card.querySelector('header small')?.textContent).toBe('월요일 23:00');
  expect(card.querySelector('header b')?.textContent).toBe('1');
  await act(async () => { cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  expect(card.querySelector('header b')?.textContent).toBe('2');
  expect(panel.querySelector('section[aria-label="재생 횟수"] header b')?.textContent).toBe('2');
  const liked = [...panel.querySelectorAll('span')].find((term) => term.textContent === '좋아요');
  expect(liked?.nextElementSibling?.textContent).toBe('1');
});

it('没有播放时间记录时看过那一层不出热力图，留一张说明卡', async () => {
  const { host } = await open(payload({ play_activity: { timezone: 'UTC+08:00', days: [], hours: [] } }));
  await click(tabNamed(host, '시청함'));
  expect(host.querySelector('[role=tabpanel] svg[role=img]')).toBeNull();
  expect(host.querySelector('[role=tabpanel] section[aria-label="재생 시간"] p')?.textContent)
    .toBe('재생을 시작하면 요일별 재생 시간대가 여기에 표시됩니다.');
});

it('全是 0 的分布图与没有分段的径向图都换成说明卡', async () => {
  const { host } = await open(payload({
    by_library: [],
    by_quality: [{ k: '4K', n: 0 }, { k: '1080P', n: 0 }],
  }));
  const panel = host.querySelector('[role=tabpanel]')!;
  expect(panel.querySelector('section[aria-label="미디어 라이브러리"] p')?.textContent)
    .toBe('미디어 폴더를 미디어 라이브러리에 배정하면 라이브러리별 동영상 수가 여기에 표시됩니다.');
  expect(panel.querySelector('section[aria-label="화질"] p')?.textContent).toBe('화질을 확인하면 화질 분포가 여기에 표시됩니다.');
});

it('计数取不到时读「未取得」，不白屏也不读成 NaN', async () => {
  const { host } = await open(payload({
    tag_cov: null,
    attribution: { videos: 4, creator: null, code: null, studio: null, thumb: null, duration: null },
    consumption: {
      played: null, library_played: null, online_played: null, play_seconds: null,
      o_total: null, liked: null, dislike: null, seen: null, trash: null, skimmed: null,
    },
  }));
  const cards = [...host.querySelectorAll('[role=tablist]')[0]!.querySelectorAll('[role=tab]')];
  expect(cards.map((tab) => tab.querySelector('b')?.textContent)).toEqual(['4', '가져오지 못함', '가져오지 못함', '1 개 볼륨']);
  expect(host.textContent).not.toContain('NaN');
});

it('计数加千分位，百分比夹在 0 到 100，有一点就不读 0%', () => {
  expect(fmtCount(1234567)).toBe((1234567).toLocaleString());
  expect(fmtCount(null)).toBe('가져오지 못함');
  expect([percentOf(150, 100), percentOf(-3, 100), percentOf(5, 0), percentOf(null, 10)]).toEqual([100, 0, 0, 0]);
  expect([percentText(1, 1000), percentText(0, 1000), percentText(1, 2)]).toEqual(['<1%', '0%', '50%']);
});

it('播放时长：不到一小时读分钟，不到 48 小时读小时，再往上读天', () => {
  expect([playedFor(1800), playedFor(7200), playedFor(48 * 3600), playedFor(-5), playedFor(null)])
    .toEqual(['30 분', '2.0 시간', '2 일', '0 분', '가져오지 못함']);
});

it('径向图超过六段并掉尾部，体积跟着合计；负数与非有限值不画', () => {
  const rows = Array.from({ length: 8 }, (_, at) => ({ name: `库${at}`, value: 80 - at * 10, bytes: 1 }));
  const slices = radialSlices([...rows, { name: '坏', value: -1 }, { name: '空', value: Number.NaN }]);
  expect(slices.map((row) => row.name)).toEqual(['库0', '库1', '库2', '库3', '库4', '나머지 3 개']);
  expect(slices.at(-1)).toEqual({ name: '나머지 3 개', value: 30 + 20 + 10, bytes: 3 });
});

it('不为 0 的段至少画满圈的 2%，0 仍是 0', () => {
  expect(radialArc(1, 1000)).toBe(20);
  expect(radialArc(500, 1000)).toBe(500);
  expect(radialArc(0, 1000)).toBe(0);
});

it('柱端读数十万以上换成万、亿', () => {
  expect([shortCount(99999), shortCount(123456), shortCount(1_234_567_890)])
    .toEqual([(99999).toLocaleString(), '12.3만', '12.3억']);
});

it('类别名放不下就截断加省略号，轴宽跟着最长的名字走并封顶', () => {
  expect(fitLabel('短名', 60)).toBe('短名');
  const long = '一个特别长的类别名字';
  const cut = fitLabel(long, 60);
  expect(cut).toMatch(/^一个.*…$/);
  expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  expect(labelWidth(cut)).toBeLessThanOrEqual(60);
  expect(categoryAxisWidth(['ab'])).toBe(36);
  expect(categoryAxisWidth(['一个特别长的类别名字一个特别长的类别名字'])).toBe(104);
});

it('覆盖率那一层的每条进度用同一对分子分母，不另算一遍', async () => {
  const { host } = await open();
  await click(tabNamed(host, '콘텐츠 태그'));
  const bars = [...host.querySelectorAll('[role=progressbar]')];
  expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
    '크리에이터 정보 있음：3 / 4', '품번 있음：2 / 4', '레이블 있음：1 / 4', '프레임 추출 완료：4 / 4', '재생 시간 확인 완료：4 / 4',
  ]);
});

it('取不到容量的卷不画使用率，只说取不到', async () => {
  const { host } = await open(payload({
    storage_volumes: [{ kind: 'media', label: 'B:', root: null, online: true, free: null, used: null, total: null }],
    storage_summary: { volumes: 1, online: 1, measured: 0, free: 0, used: 0, total: 0 },
  }));
  await click(tabNamed(host, '사용 공간'));
  const panel = host.querySelectorAll('[role=tabpanel]')[0]!;
  expect(panel.textContent).toContain('용량을 가져오지 못했습니다');
  expect(panel.textContent).toContain('매핑되지 않음');
  expect(panel.querySelector('[role=progressbar]')).toBeNull();
});

it('按字节计的卷在百格画布上按真实比例画出已用那一段，读屏值仍是字节', async () => {
  const total = 2_031_179_788_288;
  const used = 1_828_061_809_459;
  const { host } = await open(payload({
    storage_volumes: [{ kind: 'system', label: '系统盘', root: 'C:\\', online: true, free: total - used, used, total }],
    storage_summary: { volumes: 1, online: 1, measured: 1, free: total - used, used, total },
  }));
  await click(tabNamed(host, '사용 공간'));
  const bar = host.querySelectorAll('[role=tabpanel]')[0]!.querySelector('[role=progressbar]')!;
  expect(bar.getAttribute('aria-valuemax')).toBe(String(total));
  expect(bar.getAttribute('aria-valuenow')).toBe(String(used));
  expect(bar.getAttribute('viewBox')).toBe('0 0 100 1');
  expect(Number(bar.querySelectorAll('rect')[1]!.getAttribute('width'))).toBeCloseTo(90, 1);
  expect(host.querySelectorAll('[role=tabpanel]')[0]!.textContent).toContain('90%');
});

it('排行收起时后两项不可交互，箭头原地展开并能收回', async () => {
  const tags = Array.from({ length: 12 }, (_, index) => ({ k: `tag:${index}`, n: 12 - index, cat: 'genre' }));
  const { host } = await open(payload({ top_tags: tags }));
  const rows = host.querySelectorAll('ol li');
  const expand = host.querySelector<HTMLButtonElement>('button[aria-label="순위 더 보기"]');
  expect(rows).toHaveLength(12);
  expect(rows[10]?.hasAttribute('inert')).toBe(true);
  expect(expand?.querySelector('svg')).not.toBeNull();
  expect(expand?.textContent).toBe('');
  await click(expand);
  expect(rows[10]?.hasAttribute('inert')).toBe(false);
  expect(host.querySelector('[data-expandable-ranking]')?.hasAttribute('data-animating')).toBe(true);
  await click(host.querySelector('button[aria-label="순위 접기"]'));
  expect(rows[10]?.hasAttribute('inert')).toBe(true);
});

it('点一个内容标签把键交回给壳，页面自己不跳转', async () => {
  const { host, props } = await open();
  await click(host.querySelector('ol li button'));
  expect(props.onTag.mock.calls).toEqual([['tag:a']]);
});

it('快进扫过和正常看完是两回事，一行里分得出来', async () => {
  expect(watchNote({
    id: 1, name: '', creator: null, play_seconds: 100, duration: 1000, max_reached: 0.9, o_count: 0, kind: 'library',
  })).toBe('빨리 감기로 훑어봄');
  const { host } = await open();
  await click(tabNamed(host, '최근 시청'));
  const entry = host.querySelector('[role=tabpanel] article')!;
  expect(entry.querySelector('a')?.getAttribute('href')).toBe('/assets/42');
  expect(entry.textContent).toContain('실제 시청 50% · 도달 위치 90%');
});

it('一个视频都没有时给空态，能改配置就给去添加媒体文件夹', async () => {
  const { host, props } = await open(payload({ by_loc: [], by_library: [] }));
  expect(host.querySelector('h3')?.textContent).toBe('동영상이 없습니다');
  expect(radialCharts(host)).toEqual([]);
  expect(host.querySelector('[role=tabpanel] section[aria-label]')).toBeNull();
  await click(buttonNamed('미디어 폴더 추가', host));
  expect(props.openMediaSettings).toHaveBeenCalledTimes(1);
});

it('这台机器不能改配置时空态不给那个按钮，只留能走的那条路', async () => {
  const props = { ...legacyProps(), configurable: false };
  const { host } = await open(payload({ by_loc: [], by_library: [] }), props);
  expect(buttonNamed('미디어 폴더 추가', host)).toBeNull();
  expect(host.querySelector('a')?.textContent).toBe('팔로우 추가');
  expect(looksLikeButton(host.querySelector('a'))).toBe(true);
});

/** 空态里的去处画成次级实底按钮（白底、发丝边框），不是一行带下划线的文字链接。 */
const looksLikeButton = (link: Element | null) =>
  !!link && link.className.includes('border-border-button-default') && !link.className.includes('hover:underline');
const linkNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll('a')].find((a) => a.textContent === name) ?? null;

it('没有内容标签时空态给一枚「补全资料」按钮，去数据整理页', async () => {
  const { host } = await open(payload({ top_tags: [] }));
  const link = linkNamed(host, '정보 보완');
  expect(link?.getAttribute('href')).toBe('/data-cleanup');
  expect(looksLikeButton(link)).toBe(true);
});

it('首屏取数就失败时只剩一条错误，不画空看板', async () => {
  const { host } = await open(null);
  const alert = host.querySelector('[role=alert]');
  // 文案走遗留层的 `requestErrorMessage`：服务端给了中文原因就用它，页面不另说一遍。
  expect(alert?.textContent).toContain('컬렉션 통계를 읽지 못했습니다');
  expect(alert?.textContent).toContain('账本当前只能浏览');
  expect(host.querySelector('[role=tablist]')).toBeNull();
});

it('重新进这一页会重取：这一页的刷新就是重新进来一次，不吃缓存', async () => {
  const first = await open();
  expect(first.fetcher).toHaveBeenCalledTimes(1);
  await first.unmount();

  // 壳再次打开这一页：`openManagedRoute` 先 prefetch 再画。
  await prefetchStats(new AbortController().signal);
  expect(first.fetcher).toHaveBeenCalledTimes(2);
  const host = await mount(
    <QueryClientProvider client={queryClient}><StatsPage {...legacyProps()} /></QueryClientProvider>);
  expect(first.fetcher).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('원장의 현재 스냅샷 ·');
});

it('卸载之后不再敲库：这一页没有轮询，也不该留下别的定时器', async () => {
  vi.useFakeTimers();
  const { fetcher, unmount } = await open();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await unmount();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher, '卸载之后还在取数').toHaveBeenCalledTimes(1);
});

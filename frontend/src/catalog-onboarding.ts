import { emptyStateHtml } from '@peach/legacy/ui';

type Request = (url: string) => Promise<any>;
const FILTERS = ['loc', 'creator', 'performer', 'studio', 'series', 'agency', 'tag', 'tag_match', 'len', 'dur_min', 'dur_max', 'orient', 'region', 'state', 'jav', 'thumb'];

/** 推荐与当前列表共用筛选，并以实际搜索命中作为展示条件。 */
export async function catalogSuggestions(state: Record<string, string>, request: Request): Promise<string[]> {
  const params = new URLSearchParams();
  for (const key of FILTERS) if (state[key]) params.set(key, state[key]);
  const [facets, sample] = await Promise.all([
    request('/api/facets?' + params), request('/api/items?' + params + '&limit=5'),
  ]);
  const candidates: string[] = [...new Set<string>([
    ...(facets.creators || []), ...(facets.tagperformers || []), ...(facets.tags || []),
  ].map(row => String(row.k || '')).concat((sample.items || []).map((row: { code?: string; name?: string }) => row.code || row.name || '')))]
    .filter(value => value.length > 1).slice(0, 10);
  const hits = await Promise.all(candidates.map(async value => {
    const query = new URLSearchParams(params); query.set('q', value); query.set('limit', '1');
    const result = await request('/api/items?' + query);
    return result.total > 0 ? value : '';
  }));
  return hits.filter(Boolean);
}

/** 空馆藏、筛选无结果与资料尚未建立分别给出可执行入口。 */
export function catalogEmptyHtml({ kind = 'catalog', filtered = false, jav = false, configurable = false, online = false } = {}): string {
  const add = configurable ? "<button class=\"geist-button primary\" data-empty-settings>콘텐츠 추가</button>" : '';
  const follow = '<a class="geist-button' + (!configurable || online ? ' primary' : '') + "\" href=\"/subscriptions?tab=add\">팔로우 추가</a>";
  if (filtered || jav) return emptyStateHtml('search', jav ? "조건에 맞는 JAV 항목이 없습니다" : "조건에 맞는 콘텐츠가 없습니다",
    jav ? "스캔했지만 출시 정보가 없는 동영상은 전체 콘텐츠에서 볼 수 있습니다." : "필터나 검색 조건을 해제하면 전체 콘텐츠를 볼 수 있습니다.",
    { actions: "<a class=\"geist-button primary\" href=\"/?loc=&thumb=0\">전체 콘텐츠 보기</a>" });
  if (kind !== 'catalog') {
    const labels: Record<string, string> = { tags: "태그", performers: "아티스트", creators: "판매자", studios: "스튜디오", agencies: "소속사", series: "시리즈" };
    // 在线那一档数的是来源上的东西，名字也跟着来源的说法：艺人页在线摆的是关注来源里的创作者。
    const onlineLabels: Record<string, string> = { tags: "태그", performers: "크리에이터" };
    const label = (online ? onlineLabels[kind] : '') || labels[kind] || "정보";
    return emptyStateHtml(kind === 'tags' ? 'tags' : 'user-round', "아직 없음: " + label,
      online ? "팔로우 소스를 추가하고 콘텐츠를 가져오면 여기에 표시됩니다: " + label + '。' : "콘텐츠를 추가하고 정보를 보완하면 관련 정보가 표시됩니다.",
      { actions: online ? follow : add + follow });
  }
  return emptyStateHtml('play', "동영상이 없습니다", "미디어 폴더나 팔로우 소스를 추가해 컬렉션을 만드세요.", { actions: add + follow });
}

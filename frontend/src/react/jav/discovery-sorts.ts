import { JAV_RELEASE_SORT } from '../../sort-preferences';

export const DISCOVERY_SORTS = [
  ['taste', "취향", "취향 일치도순 정렬"],
  ['release_date', JAV_RELEASE_SORT[1], "출시일순 정렬"],
  ['source_score', "출처 평점", "출처 평점순 정렬"],
  ['duration', "재생 시간", "재생 시간순 정렬"],
  ['code', "품번", "품번순 정렬"],
] as const;
export type DiscoverySort = typeof DISCOVERY_SORTS[number][0];
export type DiscoveryDirection = 'asc' | 'desc';

export function discoveryScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}

/** 口味相关度使用固定百分制；未知读数保留空值。 */
export function recommendationScore(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { score: '—', label: "정보를 가져오지 못했습니다", color: 'neutral' as const };
  const score = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tier = score >= 75 ? { label: "적극 추천", color: 'lime' as const }
    : score >= 50 ? { label: "추천", color: 'blue' as const }
    : score >= 25 ? { label: "볼 만한 항목", color: 'yellow' as const }
    : { label: "둘러보기", color: 'neutral' as const };
  return { score: String(score), ...tier };
}

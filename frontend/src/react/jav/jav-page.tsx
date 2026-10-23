import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { entityPath } from '@peach/legacy/core';
import { RiCompassLine, RiExternalLinkLine } from '@remixicon/react';
import { Button, ButtonLink } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Chip } from '@/components/base/badges/chip';
import { appSettingsStore, javLayout, storeJavLayout, JAV_LAYOUTS, cardRatio, gridLayout } from '@peach/appearance';
import { coverUrl } from '@peach/card-art';
import { relayoutCovers } from '../../card-art/framing';
import { wireHorizontalScroller } from '../../ui-kit/scroll';
import { DiscoveryFaces } from './discovery-faces';
import { javContentSkeleton, javTagSkeleton, JAV_RECOMMENDATION_GRID } from '../../jav-skeleton';
import { errorMessage } from '../../api';
import { CloudDownloadDialog, type DownloadPrefill } from '../activity/cloud-download-dialog';
import { Note } from '../components/note';
import { EmptyState } from '../components/empty-state';
import { WantList } from '../wants/want-list';
import { addWant, invalidateWants } from '../wants/wants';
import { busyProps, useAction } from '../settings/use-action';
import { discoveryArtwork, discoveryKey, fetchDiscoveries, type DiscoveryScope } from './jav';
import { JavHeader } from './jav-header';
import { spriteGlyph } from '../components/sprite-glyph';
import { FilterGlassRows, FilterIconButton, FilterPill, GlassPill } from '../components/filter-glass';
import { LibraryShortcuts } from '../library-shortcuts/shortcut-controls';
import { ArtSlot } from '../components/art-slot';
import { Segments, SortKeys } from '../entity-filter/entity-filter-page';
import { TaskProgress } from '../components/task-progress';
import { DISCOVERY_SORTS, discoveryScore, recommendationScore, type DiscoverySort } from './discovery-sorts';

const SearchGlyph = spriteGlyph('search');
const MetadataStopGlyph = spriteGlyph('x');
const MetadataRefreshGlyph = spriteGlyph('refresh-cw');
import { peachHistory, shellNavigate } from '@peach/history';

function writeJavQuery(patch: Record<string, string>): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) { if (value) params.set(key, value); else params.delete(key) }
  shellNavigate(location.pathname + (params.size ? `?${params}` : ''), { replace: true, state: peachHistory.navigation.location.state });
}

export function JavPage({ tab, readOnly, navigate, receipt }: {
  tab: string; readOnly: boolean; navigate(path: string): void; receipt(message: string): void;
}) {
  const [download, setDownload] = useState<DownloadPrefill | null>(null);
  const [text, changeText] = useState(() => new URLSearchParams(location.search).get('q') || '');
  const setText = (value: string) => { changeText(value); writeJavQuery({ q: value }) };
  const search = (event: FormEvent) => { event.preventDefault() };
  return <div className="flex w-full flex-col gap-6">
    <JavHeader tab={tab} navigate={navigate} find={() => setDownload({})} />
    <form aria-label={tab === 'discover' ? "추천 필터" : "위시리스트 필터"} onSubmit={search}>
      <Input type="search" aria-label={tab === 'discover' ? "추천 필터" : "위시리스트 필터"} placeholder="품번, 배우 또는 제목으로 필터" leadingIcon={SearchGlyph}
        value={text} onChange={setText} enterKeyHint="search" />
    </form>
    {tab === 'discover'
      ? <Discover readOnly={readOnly} receipt={receipt} resource={setDownload} query={text.trim()} navigate={navigate} clearText={() => setText('')} />
      : <WantList readOnly={readOnly} toast={receipt} query={text.trim()} />}
    <CloudDownloadDialog prefill={download} close={() => setDownload(null)} receipt={receipt} />
  </div>;
}

function Discover({ readOnly, receipt, resource, query, navigate, clearText }: {
  readOnly: boolean; receipt(message: string): void; resource(work: DownloadPrefill): void; query: string;
  navigate(path: string): void; clearText(): void;
}) {
  const params = new URLSearchParams(location.search);
  const [scope, changeScope] = useState<DiscoveryScope>(() => params.get('scope') === 'library' ? 'library' : 'external');
  const [tag, changeTag] = useState(() => params.get('tag') || '');
  const [sort, changeSort] = useState<DiscoverySort>(() => DISCOVERY_SORTS.some(([key]) => key === params.get('sort'))
    ? params.get('sort') as DiscoverySort : 'taste');
  const [ascending, changeAscending] = useState(() => params.get('dir') === 'asc');
  const setScope = (value: DiscoveryScope) => { changeScope(value); writeJavQuery({ scope: value === 'external' ? '' : value }) };
  const setTag = (value: string) => { changeTag(value); writeJavQuery({ tag: value }) };
  const setSort = (value: DiscoverySort) => { changeSort(value); writeJavQuery({ sort: value === 'taste' ? '' : value }) };
  const setAscending = (value: boolean) => { changeAscending(value); writeJavQuery({ dir: value ? 'asc' : '' }) };
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const rows = section.current?.querySelectorAll('[data-catalog-scroll],[data-catalog-tags],[data-filter-row="bottom"]');
    const scrollers = [...(rows || [])].map(row => wireHorizontalScroller(row, { drag: true }));
    return () => scrollers.forEach(scroller => scroller.destroy());
  }, []);
  const settings = appSettingsStore();
  useSyncExternalStore(settings.subscribe, settings.version, settings.version);
  const layout = javLayout();
  const ratio = cardRatio(gridLayout({ active: true, home: false, portrait: false }));
  const metadataJobs = useRef<Partial<Record<DiscoveryScope, string>>>({});
  const refreshMetadata = useRef(false);
  const cancelMetadata = useRef(false);
  const direction = ascending ? 'asc' : 'desc';
  const discoveries = useQuery({ queryKey: discoveryKey(scope, sort, direction), retry: false, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      const refresh = refreshMetadata.current;
      const cancel = cancelMetadata.current;
      refreshMetadata.current = false;
      cancelMetadata.current = false;
      return fetchDiscoveries(scope, signal, { sort, direction, jobId: refresh ? undefined : metadataJobs.current[scope], refreshMetadata: refresh, cancelMetadata: cancel });
    },
    refetchInterval: current => current.state.data?.metadata_job?.status === 'running'
      ? Math.max(1000, current.state.data.poll_after_ms || 3000) : false,
  });
  const metadata = discoveries.data?.metadata_job;
  useEffect(() => { if (metadata?.job_id) metadataJobs.current[scope] = metadata.job_id }, [scope, metadata?.job_id]);
  const action = useAction();
  const metadataAction = useAction();
  const updateMetadata = (key: 'stop' | 'update' | 'retry') => {
    void metadataAction.run(key, async () => {
      cancelMetadata.current = key === 'stop';
      refreshMetadata.current = key !== 'stop';
      return discoveries.refetch({ cancelRefetch: true, throwOnError: true });
    }, () => {});
  };
  const all = discoveries.data?.items || [];
  const tags = [...new Set(all.flatMap(item => item.tags || []))];
  const items = all.filter(item => (!tag || item.tags?.includes(tag)) &&
    (!query || [item.code, item.title, item.performers, item.studio, ...(item.tags || []), ...(item.performer_refs || []).map(ref => ref.name)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const waiting = discoveries.isPending;
  return <section ref={section} aria-label="추천" aria-busy={waiting} className="flex min-w-0 flex-col gap-4">
    <FilterGlassRows label="탐색 필터 및 정렬" topLabel="탐색 범위 및 태그" attrs={{ 'data-filter-frame': '', 'data-jav-filter': '', 'data-catalog-frame': '' }}
      busy={waiting} topClassName="gap-1.5 overflow-visible" bottomClassName="min-h-12" top={<div data-catalog-scroll="">
      <div data-catalog-views="">
        {([['external', "라이브러리 밖에서 발견"], ['library', "컬렉션 탐색"]] as const).map(([key, label]) =>
          <FilterPill key={key} data-entity-tag={key} data-entity-press="" pressed={scope === key} onPress={() => { setScope(key); setTag('') }}>{label}</FilterPill>)}
        <span data-entity-sep="" aria-hidden="true" />
      </div><div data-catalog-tags="" dangerouslySetInnerHTML={waiting ? { __html: javTagSkeleton() } : undefined}>
        {waiting ? null : tags.map(name => <FilterPill key={name} data-catalog-tag={name} data-entity-press="" pressed={tag === name} onPress={() => setTag(tag === name ? '' : name)}>
          {name}<span data-count-badge="">{all.filter(item => item.tags?.includes(name)).length}</span>
        </FilterPill>)}
      </div></div>} bottom={<>
        <span data-catalog-readout="">{waiting ? <span data-skeleton="count" aria-hidden className="relative inline-block h-3.5 w-37.5 rounded-md align-middle skeleton-sheen" /> : `${items.length} 개`}</span>
        <LibraryShortcuts currentHref={() => location.pathname + location.search} />
        {query || tag ? <GlassPill onPress={() => { setTag(''); clearText() }}>필터 지우기</GlassPill> : null}
        <span data-entity-sorts="">
        {scope === 'external' ? <FilterIconButton data-entity-batch="" data-jav-metadata-update=""
          label={metadata?.status === 'running' ? "읽기 중지" : "정보 업데이트"}
          disabled={waiting} data-skeleton-action={waiting ? '' : undefined} busy={!!metadataAction.busy}
          icon={metadata?.status === 'running' ? MetadataStopGlyph : MetadataRefreshGlyph}
          onPress={() => updateMetadata(metadata?.status === 'running' ? 'stop' : 'update')} /> : null}
        <Segments label="JAV 카드 형식" value={layout} options={JAV_LAYOUTS} onChange={storeJavLayout} />
        <SortKeys sorts={DISCOVERY_SORTS.map(([key, label, ariaLabel]) => ({ key, label, ariaLabel,
          pressed: key === sort, dir: direction }))} onSort={key => {
          if (key === sort) setAscending(!ascending); else { setSort(key as DiscoverySort); setAscending(key === 'code') }
        }} /></span>
      </>} />
    {waiting ? <div role="status" aria-label="추천을 불러오는 중" dangerouslySetInnerHTML={{ __html: javContentSkeleton('discover', layout) }} /> : null}
    {discoveries.error ? <Note tone="error" title="추천을 가져오지 못했습니다">{errorMessage(discoveries.error)}</Note> : null}
    {scope === 'external' && metadata?.status === 'running' ? <div data-jav-metadata="" className="min-w-0"><TaskProgress embedded
        label={`항목 정보 불러오는 중 · ${metadata.completed} / ${metadata.total} 개`} value={metadata.completed} total={metadata.total} /></div> : null}
    {metadata && metadata.status !== 'running' && (metadata.status !== 'complete' || metadata.failed > 0)
      ? <Note tone="neutral" action={<Button variant="secondary" {...busyProps(metadataAction.busy === 'retry')}
        onClick={() => updateMetadata('retry')}>정보 다시 불러오기</Button>}>{metadata.message || `항목 정보 ${metadata.completed} / ${metadata.total} 개`}</Note> : null}
    {metadataAction.error ? <Note tone="error">{metadataAction.error}</Note> : null}
    {!waiting && !discoveries.error && !items.length ? <EmptyState shell="plain" icon={RiCompassLine} title={query || tag ? "조건에 맞는 추천이 없습니다" : "아직 취향에 맞는 항목이 없습니다"}
      actions={<ButtonLink href="/taste" variant="secondary">취향 보기</ButtonLink>}>
      {query || tag ? "필터를 지우면 다른 항목을 볼 수 있습니다." : scope === 'library' ? "항목을 시청하거나 표시하면 자주 보지 않은 컬렉션 항목을 탐색할 수 있습니다." : "품번을 찾거나 팔로우 출처를 업데이트할 수 있습니다."}
    </EmptyState> : null}
    {action.error ? <Note tone="error">{action.error}</Note> : null}
    <div data-media-grid="" className={JAV_RECOMMENDATION_GRID} style={{ '--card-ratio': ratio } as CSSProperties}>
      {items.map(item => {
        const performers = item.performer_refs?.length ? item.performer_refs.map(person => person.name).join('、') : item.performers;
        const artwork = discoveryArtwork(item, layout, settings.value.javImage);
        const recommendation = recommendationScore(item.taste_score ?? item.score);
        const scoreDetails = [recommendation.label, `취향 ${discoveryScore(item.taste_score ?? item.score)}`,
          discoveries.data?.ranking_method === 'mmr' && item.ranking_score != null ? `정렬 ${discoveryScore(item.ranking_score)}` : '',
          item.source_score != null ? `출처 평점 ${item.source_score.toFixed(1)} / 5` : '', ...(item.reasons || [])].filter(Boolean).join(' · ');
        return <article key={item.id} data-media-card="" data-jav-card="" onClick={event => {
        if (!(event.target as HTMLElement).closest('a,button,input')) navigate(item.asset_id ? `/assets/${item.asset_id}` : `/works/${encodeURIComponent(item.code)}`);
      }}>
        <a href={item.asset_id ? `/assets/${item.asset_id}` : `/works/${encodeURIComponent(item.code)}`} aria-label={`보기: ${item.code} 상세 정보`}
          onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(event.currentTarget.getAttribute('href')!) } }}
          data-media-pic="" data-jav-cover-box="" className="relative inline-grid place-items-center overflow-hidden rounded-2lg bg-background-tertiary-default">
          {artwork ? <ArtSlot artwork={{ kind: 'cover', html: artwork }} identity={discoveryArtwork(item, 'small', settings.value.javImage)}
            relayout={root => relayoutCovers(root, layout)} /> : <span data-media-nopic="">표지 없음</span>}
        </a>
        <div data-media-meta="">
          <DiscoveryFaces item={item} />
          <div data-media-text="">
            <h3 data-jav-title="" data-media-title="" title={`${item.code} · ${item.title || "제목을 가져오지 못했습니다"}`}><b>{item.code}</b> {item.title || "제목을 가져오지 못했습니다"}</h3>
            <div data-media-byline="">
              {item.performer_refs?.[0]?.id ? <a data-media-who="" href={entityPath('performer', item.performer_refs[0].name)} title={performers}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-user-round" /></svg><span>{item.performer_refs[0].name}</span></a>
                : <span data-media-who="" title={performers}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-user-round" /></svg><span>{item.performer_refs?.[0]?.name || performers}</span></span>}
              {(item.performer_refs?.length || 0) > 1 ? <span data-media-who-more="">등 {item.performer_refs!.length} 명</span> : null}
              {item.release_date ? <time data-media-release="" dateTime={item.release_date}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-calendar" /></svg>{item.release_date}</time> : null}
            </div>
        <div data-jav-tags="" data-media-tags="">
          <button data-jav-taste-score="" type="button" title={scoreDetails} aria-label={`추천 점수 ${recommendation.score}，${recommendation.label}`}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
            <Chip color={recommendation.color}>{recommendation.label}</Chip>
          </button>
          {(item.tags || []).slice(0, 4).map(name =>
          <button type="button" data-media-tag="" key={name} aria-pressed={tag === name} onClick={() => setTag(tag === name ? '' : name)}>{name}</button>)}</div>
          </div>
        </div>
        <div data-jav-actions="" className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => resource({ ...item, cover: item.has_cover ? coverUrl(item, true) : item.cover_url, origin: `${item.asset_id ? 'asset' : 'feed'}:${item.id}` })}>리소스 찾기</Button>
          <Button variant="ghost" disabled={readOnly || item.wanted || !!item.asset_id} {...busyProps(action.busy === String(item.id))} onClick={() => {
            void action.run(String(item.id), signal => addWant({ code: item.code }, signal), () => {
              receipt("위시리스트에 추가했습니다"); void invalidateWants(); void discoveries.refetch();
            });
          }}>{item.asset_id ? "라이브러리에 추가됨" : item.wanted ? "위시리스트에 추가했습니다" : "위시리스트"}</Button>
          {item.link ? <ButtonLink data-button-link="" variant="secondary" trailingIcon={RiExternalLinkLine} href={item.link} target="_blank" rel="noopener noreferrer">항목 출처</ButtonLink> : null}
        </div>
      </article>})}
    </div>
  </section>;
}

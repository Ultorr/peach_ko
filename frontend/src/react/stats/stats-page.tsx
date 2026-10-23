/* 统计页：账本此刻的样子。
 *
 * 一屏回答两层问题。上面四张卡既是读数也是页签——馆藏、看过、内容标签、使用空间，点哪张
 * 就在下面展开哪一层的细节；再下面那块按维度排：内容标签排行、最近看过、标签来源。
 * 四张卡同时当页签是因为这一页没有别的主动作，读数本身就是入口。
 *
 * 页签走 React Aria 的 `Tabs`：`role=tablist`／`tab`／`tabpanel`、左右方向键与游标式
 * `tabindex` 都由它给，注册表里的 `tabs` 条目是页面级导航，不是这种同页切块。
 * 体积与来源名共用 `src/core/index.ts` 的口径；标签的界面名称由遗留层的 `tagLabel` 递进来。 */
import {
  RiDatabase2Line, RiEyeLine, RiHardDrive2Line, RiHistoryLine, RiPriceTag3Line, RiVideoLine,
} from '@remixicon/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import { fmtSize, LOC } from '@peach/legacy/core';
import { MEDIA_SOURCE_ICONS } from '@peach/legacy/ui';

import { Button, ButtonLink } from '@/components/base/buttons/button';

import { errorMessage } from '../../api';
import type { StatsProps } from '../bundle';
import { BarCard } from '../charts/bar-card';
import { CHART_COLORS } from '../charts/chart-card';
import { ActivityHeat } from '../charts/heat-card';
import { cardClass } from '../components/card';
import { EmptyState } from '../components/empty-state';
import { ExpandableRanking } from '../components/expandable-ranking';
import { Note } from '../components/note';
import { Page } from '../components/page';
import { Progress } from '../components/progress';
import { SEGMENT, SEGMENTED_TRACK, SegmentedTabList } from '../components/segmented';
import { StatCard, statCardClass, STAT_STRIP } from '../components/stat-card';
import { RadialCard } from './radial-card';
import {
  bandRows, fetchStats, fmtCount, known, lengthRows, mediumRows, percentText, playedFor, playedItemUrl,
  reachedShare, replayRows, STATS_KEY, watchedShare, watchNote,
  type Attribution, type Count, type RecentPlay, type StatsData, type StorageVolume, type TagSource, type TopTag,
} from './stats';

/** 收起时露这么多条排行。三十条一次铺开会把下面两个面板整个顶到屏外。 */
const RANKING_PREVIEW = 10;

/** 图表色跟着上面那张读数卡的强调色走：馆藏是 `chart-6`，看过是 `chart-5`（`StatCard` 的 `accent`）。 */
const INVENTORY_COLOR = CHART_COLORS[5];
const VIEWING_COLOR = CHART_COLORS[4];

const CARD = `${cardClass()} flex flex-col gap-4`;

const NO_VIDEO_HINT = "미디어 폴더를 추가하거나 소스를 팔로우하면 컬렉션 통계가 여기에 표시됩니다.";
const NO_TAG_HINT = "정보를 보완하거나 태그를 추가하면 컬렉션의 콘텐츠 태그가 여기에 표시됩니다.";
const NO_WATCH_HINT = "재생을 시작하면 최근 실제 시청 기록이 여기에 표시됩니다.";
const NO_TAG_SOURCE_HINT = "메타데이터를 수집하거나 태그를 직접 추가하면 소스별로 태그가 적용된 동영상 수가 여기에 표시됩니다.";
const NO_VOLUME_HINT = "미디어 폴더를 추가하면 저장 공간이 여기에 표시됩니다.";
const NO_LIBRARY_HINT = "미디어 폴더를 미디어 라이브러리에 배정하면 라이브러리별 동영상 수가 여기에 표시됩니다.";
const NO_LENGTH_HINT = "재생 시간을 확인하면 재생 시간 분포가 여기에 표시됩니다.";
const NO_QUALITY_HINT = "화질을 확인하면 화질 분포가 여기에 표시됩니다.";
const NO_PLAY_TIME_HINT = "재생을 시작하면 요일별 재생 시간대가 여기에 표시됩니다.";
const NO_REPLAY_HINT = "재생을 시작하면 각 항목의 재생 횟수가 여기에 표시됩니다.";

/** 进度条的读数：超出总数时按满格画，读屏值也不越过上限。 */
const within = (value: number, max: number) => Math.min(Math.max(value, 0), max);

/** 一格事实：一个名字配一个数。面取浮层那一档（旧 `.insightfacts .kv` 的 `--surface`），
 *  比卡面亮一级。 */
function Fact({ term, value }: { term: string; value: Count }) {
  return (
    <div className="flex min-h-16 min-w-0 flex-col gap-1.5 rounded-2lg bg-background-primary-default p-3">
      <span className="text-caption-1-regular text-text-secondary">{term}</span>
      <b className="text-title-3-medium tabular-nums text-text-primary">{fmtCount(value)}</b>
    </div>
  );
}

/** 一条带进度的覆盖率：读数、占比与那条条共用同一对分子分母。 */
function Coverage({ term, value, total }: { term: string; value: Count; total: number }) {
  const max = Math.max(total, 1);
  return (
    <div className="flex flex-col gap-1.5 border-b border-separator-border py-3 last:border-b-0">
      <p className="flex items-baseline justify-between gap-3 text-body-2-regular text-text-primary">
        <span>{term}</span>
        <b className="tabular-nums">
          {fmtCount(value)}
          {known(value)
            ? <span className="ml-1.5 text-caption-1-regular text-text-secondary">{percentText(value, total)}</span>
            : null}
        </b>
      </p>
      <Progress label={`${term}：${fmtCount(value)} / ${total.toLocaleString()}`}
        value={known(value) ? within(value, max) : 0} max={max} />
    </div>
  );
}

/** 详情那一格的左栏：一句分类、一个大数、一句它的单位。
 *
 * 两栏之间不画线：旧 `board.css` 专门把 `.insightcopy` 的 `border-right` 清成 `border:0`，
 * 一张填充卡里再切一刀，看起来就是两张卡挤在一起。 */
function Headline({ term, figure, unit }: { term: string; figure: string; unit: string }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 pb-5 md:w-64 md:pr-6 md:pb-0">
      <span className="text-caption-1-regular text-text-secondary">{term}</span>
      <b className="text-display-4-medium tabular-nums text-text-primary">{figure}</b>
      <span className="text-body-2-regular text-text-secondary">{unit}</span>
    </div>
  );
}

/** 详情那一格：左边一个读数，右边它的展开。 */
function Detail({ headline, children }: { headline: ReactNode; children: ReactNode }) {
  return (
    <div className={`${CARD} md:flex-row md:gap-6`}>
      {headline}
      <div className="min-w-0 grow">{children}</div>
    </div>
  );
}

function InventoryDetail({ data, configurable, openMediaSettings }: { data: StatsData } & StatsProps) {
  const videos = data.by_loc.reduce((sum, row) => sum + row.videos, 0);
  if (!videos) {
    return (
      <EmptyState shell="plain" icon={RiVideoLine} title="동영상이 없습니다" actions={
        <>
          {configurable
            ? <Button size="small" onClick={openMediaSettings}>미디어 폴더 추가</Button>
            : null}
          <ButtonLink variant="secondary" href="/subscriptions?tab=add" size="small">팔로우 추가</ButtonLink>
        </>
      }>{NO_VIDEO_HINT}</EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="inline-grid w-full gap-5 md:grid-cols-2">
        <RadialCard title="클라우드 및 로컬" empty={NO_VIDEO_HINT} rows={data.by_loc.map((row) => (
          { name: LOC[row.k] ?? row.k, value: row.videos, bytes: row.bytes, mark: MEDIA_SOURCE_ICONS[row.k] || 'database' }))} />
        <RadialCard title="미디어 라이브러리" empty={NO_LIBRARY_HINT} rows={data.by_library.map((row) => (
          { name: row.name, value: row.videos, bytes: row.bytes, mark: MEDIA_SOURCE_ICONS[row.icon] || row.icon || 'database' }))} />
      </div>
      <div className="inline-grid w-full gap-5 md:grid-cols-2 xl:grid-cols-3">
        <BarCard title="재생 시간" unit="개 동영상" series="동영상" color={INVENTORY_COLOR}
          rows={lengthRows(data.by_length)} empty={NO_LENGTH_HINT} />
        <BarCard title="화질" unit="개 동영상" series="동영상" color={INVENTORY_COLOR}
          rows={bandRows(data.by_quality)} empty={NO_QUALITY_HINT} />
        <BarCard title="파일 형식" unit="개 항목" series="항목" color={INVENTORY_COLOR} layout="horizontal"
          rows={mediumRows(data.by_medium)} empty={NO_VIDEO_HINT} />
      </div>
    </div>
  );
}

/** 看过那一层的图：最近一次播放落在什么时候，和每个作品播了几次。 */
function ViewingCharts({ data }: { data: StatsData }) {
  return (
    <>
      <ActivityHeat activity={data.play_activity} title="재생 시간" dailyTitle="일별 재생"
        words={{ unit: "개 항목", series: "항목", cellUnit: "개 항목" }} tone={5} empty={NO_PLAY_TIME_HINT} />
      <BarCard title="재생 횟수" unit="개 항목" series="항목" color={VIEWING_COLOR}
        rows={replayRows(data.replays)} empty={NO_REPLAY_HINT} />
    </>
  );
}

function CoverageDetail({ attribution }: { attribution: Attribution }) {
  const videos = attribution.videos;
  return (
    <div className="flex flex-col">
      <Coverage term="크리에이터 정보 있음" value={attribution.creator} total={videos} />
      <Coverage term="품번 있음" value={attribution.code} total={videos} />
      <Coverage term="레이블 있음" value={attribution.studio} total={videos} />
      <Coverage term="프레임 추출 완료" value={attribution.thumb} total={videos} />
      <Coverage term="재생 시간 확인 완료" value={attribution.duration} total={videos} />
    </div>
  );
}

/** 一个卷一行，与覆盖率同一个节律：名字配已用量与占比，下面一条进度，再下面一行小字
 *  写它挂在哪、还剩多少。取不到容量的卷不画进度，读数那一格换成它的状态。 */
function VolumeRow({ volume }: { volume: StorageVolume }) {
  const total = volume.total;
  const used = volume.used ?? 0;
  return (
    <article className="flex min-w-0 flex-col gap-1.5 border-b border-separator-border py-3 last:border-b-0">
      <header className="flex items-baseline justify-between gap-3 text-body-2-regular text-text-primary">
        <h3 className="min-w-0 break-words">{volume.label}</h3>
        {total != null ? (
          <b className="whitespace-nowrap tabular-nums">
            {fmtSize(used)}
            <span className="ml-1.5 text-caption-1-regular text-text-secondary">{percentText(used, total)}</span>
          </b>
        ) : <span className="whitespace-nowrap text-text-secondary">{volume.online ? "용량을 가져오지 못했습니다" : "오프라인"}</span>}
      </header>
      {total != null
        ? <Progress label={`${volume.label}공간 사용률`} value={within(used, Math.max(total, 1))} max={Math.max(total, 1)} />
        : null}
      <p className="flex justify-between gap-3 text-caption-1-regular text-text-secondary">
        <span className="min-w-0 break-words">{volume.root ?? "매핑되지 않음"}</span>
        {total != null
          ? <span className="whitespace-nowrap tabular-nums">{`사용 가능: ${fmtSize(volume.free ?? 0)} · 전체: ${fmtSize(total)}`}</span>
          : null}
      </p>
    </article>
  );
}

function StorageDetail({ volumes, configurable, openMediaSettings }: { volumes: StorageVolume[] } & StatsProps) {
  if (!volumes.length) {
    return (
      <EmptyState shell="plain" icon={RiHardDrive2Line} title="저장 소스가 아직 없습니다" actions={
        configurable ? <Button size="small" onClick={openMediaSettings}>미디어 폴더 추가</Button> : undefined
      }>{NO_VOLUME_HINT}</EmptyState>
    );
  }
  return (
    <div className="flex flex-col">
      {volumes.map((volume) => <VolumeRow key={`${volume.kind}:${volume.label}`} volume={volume} />)}
    </div>
  );
}

function TagRanking({ tags, tagLabel, onTag }: { tags: TopTag[] } & StatsProps) {
  if (!tags.length) {
    return (
      <EmptyState shell="plain" icon={RiPriceTag3Line} title="콘텐츠 태그가 아직 없습니다"
        actions={<ButtonLink variant="secondary" href="/data-cleanup" size="small">정보 보완</ButtonLink>}>{NO_TAG_HINT}</EmptyState>
    );
  }
  return (
    <ExpandableRanking previewCount={RANKING_PREVIEW}
      className="inline-grid w-full gap-x-6 gap-y-1 sm:grid-cols-2">
        {tags.map((tag, index) => (
          <li key={`${tag.k}:${index}`} className="min-w-0">
            <button type="button" onClick={() => onTag(tag.k)}
              className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
              <span className="w-6 shrink-0 text-caption-1-regular tabular-nums text-text-secondary">{index + 1}</span>
              <span className="min-w-0 grow text-body-2-regular break-words text-text-primary">{tagLabel(tag.k)}</span>
              <b className="text-body-2-medium tabular-nums text-text-secondary">{tag.n.toLocaleString()}</b>
            </button>
          </li>
        ))}
    </ExpandableRanking>
  );
}

function RecentWatches({ rows }: { rows: RecentPlay[] }) {
  if (!rows.length) {
    return (
      <EmptyState shell="plain" icon={RiHistoryLine} title="시청 기록이 아직 없습니다"
        actions={<ButtonLink variant="secondary" href="/" size="small">컬렉션 둘러보기</ButtonLink>}>{NO_WATCH_HINT}</EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {rows.map((row) => {
        const real = watchedShare(row);
        return (
          <article key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0 grow basis-64">
              <h3 className="min-w-0 text-body-2-medium text-text-primary">
                <a href={playedItemUrl(row)} data-middle-truncate
                  className="block max-w-full overflow-hidden whitespace-nowrap hover:underline">{row.name}</a>
              </h3>
              <p className="flex flex-wrap gap-3 text-caption-1-regular text-text-secondary">
                {row.creator ? <span className="min-w-0 wrap-anywhere">{row.creator}</span> : null}
                <span>{watchNote(row)}</span>
              </p>
            </div>
            <div className="min-w-0 basis-40">
              <Progress label={`실제 시청 ${real.toFixed(0)}%`} value={real} />
              <small className="mt-1.5 block text-caption-1-regular text-text-secondary">
                {`실제 시청 ${real.toFixed(0)}% · 도달 위치 ${reachedShare(row).toFixed(0)}%`}
              </small>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TagSources({ sources, videos }: { sources: TagSource[]; videos: number }) {
  if (!sources.length) {
    return (
      <EmptyState shell="plain" icon={RiPriceTag3Line} title="태그 소스가 아직 없습니다"
        actions={<ButtonLink variant="secondary" href="/data-cleanup" size="small">정보 보완</ButtonLink>}>{NO_TAG_SOURCE_HINT}</EmptyState>
    );
  }
  return (
    <div className="inline-grid w-full gap-x-8 gap-y-6 sm:grid-cols-2">
      {sources.map((source) => (
        <article key={source.k} className="flex min-w-0 flex-col gap-1.5">
          <header className="flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 text-body-2-medium break-words text-text-primary">{source.k}</h3>
            <b className="text-body-2-medium whitespace-nowrap text-text-primary">
              {source.assets.toLocaleString()}
              <small className="ml-1 text-caption-1-regular font-normal text-text-secondary">개 동영상</small>
            </b>
          </header>
          <Progress label={`${source.k} 태그가 적용된 동영상`} value={within(source.assets, Math.max(videos, 1))}
            max={Math.max(videos, 1)} />
          <small className="text-caption-1-regular text-text-secondary">{source.n.toLocaleString()} 개 태그</small>
        </article>
      ))}
    </div>
  );
}

/** 一张既是读数也是页签的卡。选中态是换一档卡面再压一圈 2px 内描边，不靠加粗或换字色。 */
function MetricTab(
  { id, label, figure, detail, icon: Icon, accent }:
  { id: string; label: string; figure: string; detail: string; icon: typeof RiEyeLine; accent: number },
) {
  return (
    <Tab id={id} className={statCardClass({ interactive: true, selectable: true })}>
      <StatCard label={label} icon={Icon} accent={accent} figure={figure} footer={detail} />
    </Tab>
  );
}

export function StatsPage(props: StatsProps) {
  const stats = useQuery({ queryKey: STATS_KEY, queryFn: ({ signal }) => fetchStats(signal) });
  const data = stats.data;
  if (!data) {
    return (
      <Page>
        <Note tone="error" title="컬렉션 통계를 읽지 못했습니다">{stats.error ? errorMessage(stats.error) : "통계 데이터를 가져오지 못했습니다. 페이지를 새로 고친 후 다시 시도하세요."}</Note>
      </Page>
    );
  }
  const consumption = data.consumption;
  const storage = data.storage_summary;
  const videos = data.by_loc.reduce((sum, row) => sum + row.videos, 0);
  const bytes = data.by_loc.reduce((sum, row) => sum + row.bytes, 0);
  const coverage = known(data.tag_cov) ? percentText(data.tag_cov, data.attribution.videos) : "가져오지 못함";
  const covered = `${fmtCount(data.tag_cov)} / ${data.attribution.videos.toLocaleString()}`;
  return (
    <Page>
      <p className="text-caption-1-regular text-text-secondary">
        {`원장의 현재 스냅샷 · ${videos.toLocaleString()} 개 동영상 · ${fmtSize(bytes)}`}
      </p>
      <Tabs defaultSelectedKey="inventory" className="flex flex-col gap-4">
        <TabList aria-label="통계 보기" className={STAT_STRIP}>
          <MetricTab id="inventory" label="컬렉션 동영상" icon={RiDatabase2Line} accent={0}
            figure={videos.toLocaleString()} detail={fmtSize(bytes)} />
          <MetricTab id="viewing" label="시청함" icon={RiEyeLine} accent={1}
            figure={fmtCount(consumption.played)} detail={playedFor(consumption.play_seconds)} />
          <MetricTab id="coverage" label="콘텐츠 태그" icon={RiPriceTag3Line} accent={2}
            figure={coverage} detail={covered} />
          <MetricTab id="storage" label="사용 공간" icon={RiHardDrive2Line} accent={3}
            figure={`${storage.online.toLocaleString()} 개 볼륨`}
            detail={storage.measured ? `사용 중: ${fmtSize(storage.used)}` : "용량을 가져오지 못했습니다"} />
        </TabList>
        <TabPanel id="inventory"><InventoryDetail data={data} {...props} /></TabPanel>
        <TabPanel id="viewing" className="flex flex-col gap-5">
          <Detail headline={<Headline term="시청" figure={fmtCount(consumption.played)} unit="개 항목에 재생 기록 있음" />}>
            <div className="inline-grid w-full gap-3 sm:grid-cols-2">
              <Fact term="컬렉션 시청" value={consumption.library_played} />
              <Fact term="온라인으로 바로 시청" value={consumption.online_played} />
              <Fact term="오르가슴 횟수" value={consumption.o_total} />
              <Fact term="빨리 감기로 훑어봄" value={consumption.skimmed} />
              <Fact term="좋아요" value={consumption.liked} />
              <Fact term="싫어요 표시" value={consumption.dislike} />
              <Fact term="이미 봤어요" value={consumption.seen} />
              <Fact term="휴지통" value={consumption.trash} />
            </div>
          </Detail>
          <ViewingCharts data={data} />
        </TabPanel>
        <TabPanel id="coverage">
          <Detail headline={<Headline term="콘텐츠 태그 적용 범위" figure={coverage} unit={covered} />}>
            <CoverageDetail attribution={data.attribution} />
          </Detail>
        </TabPanel>
        <TabPanel id="storage">
          <Detail headline={<Headline term="사용 공간" figure={storage.measured.toLocaleString()} unit="개 볼륨의 용량 확인 완료" />}>
            <StorageDetail volumes={data.storage_volumes} {...props} />
          </Detail>
        </TabPanel>
      </Tabs>
      {/* 旧 `.insightpanel`：整块一张 16px 的填充卡，页签是卡内顶上那条分段控件。 */}
      <Tabs defaultSelectedKey="tags" className={`${cardClass({ padding: 'none' })} flex flex-col`}>
        <div className="px-4 pt-3">
          <SegmentedTabList aria-label="통계 기준" className={SEGMENTED_TRACK}>
            <Tab id="tags" className={SEGMENT}>콘텐츠 태그</Tab>
            <Tab id="recent" className={SEGMENT}>최근 시청</Tab>
            <Tab id="sources" className={SEGMENT}>태그 출처</Tab>
          </SegmentedTabList>
        </div>
        <TabPanel id="tags" className="px-4 pt-3.5 pb-4"><TagRanking tags={data.top_tags} {...props} /></TabPanel>
        <TabPanel id="recent" className="px-4 pt-3.5 pb-4"><RecentWatches rows={data.recent} /></TabPanel>
        <TabPanel id="sources" className="px-4 pt-3.5 pb-4">
          <TagSources sources={data.tag_source} videos={data.attribution.videos} />
        </TabPanel>
      </Tabs>
    </Page>
  );
}

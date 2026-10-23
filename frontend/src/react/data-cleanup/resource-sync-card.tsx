/* 数据管理页上的「资源同步」：按馆藏记录逐条查找本地磁盘与网盘上的文件，列出文件已不在的
 * 记录、空文件夹和不再被引用的缓存，确认后一起清掉（ADR-0080）。失效记录分两档：带个人记录的
 * 标为已消失、记录留着（ADR-0087），其余永久删除、不进回收站，所以执行键是危险档，确认框写明
 * 哪一档不可撤销。
 *
 * 扫描与清理是两趟后台任务，都走 `useBackgroundJob`。扫描的结论就是那趟任务的终态，所以
 * 结果区画的是当前快照：上一趟扫出来的东西还等着清。那一趟清过之后（`applied`）读数就不是
 * 现状了，结果区改画服务器留着的最近一次清理回执。 */
import { confirmModal, MEDIA_SOURCE_ICONS } from '@peach/legacy/ui';
import { fmtSize } from '@peach/legacy/core';

import { Button } from '@/components/base/buttons/button';

import { errorMessage } from '../../api';
import { useBackgroundJob } from '../background-job';
import { Fieldset, FieldsetTitle } from '../components/fieldset';
import { Note } from '../components/note';
import { TaskProgress } from '../components/task-progress';
import { spriteGlyph } from '../components/sprite-glyph';
import { PlainStat, plainStatClass } from '../components/stat-card';
import { queryClient } from '../query';
import { SourceMark } from '../settings/section';
import { busyProps } from '../settings/use-action';
import { TRASH_KEY } from './data-cleanup';
import {
  applyConfirmText, applyLeftovers, applyPlanText, applyText, fetchResourceApply, fetchResourceScan, hasChanges,
  purgeCount, RESOURCE_APPLY_KEY, RESOURCE_SCAN_KEY, scanLine, SOURCE_LABELS, sourceMeta, startResourceApply, startResourceScan,
  type ResourceApplyState, type ResourceScanState,
} from './resource-sync';

const COMPARE = spriteGlyph('git-compare');
const AGAIN = spriteGlyph('rotate-cw');
const DISCONNECTED = "진행 상황을 읽을 수 없어 다시 연결 중…";
const APPLY_LABEL = "유효하지 않은 항목 정리";

/* 结果读数两行各自按卡数等分：来源几个都不折出半行。窄了照顶上那排读数折两列、一列。 */
const RESULT_ROW = 'inline-grid w-full grid-flow-col auto-cols-fr gap-4 max-plain-stat-pair:grid-flow-row'
  + ' max-plain-stat-pair:grid-cols-2 max-plain-stat-single:grid-cols-1';

const count = (value: number | undefined) => Number(value || 0).toLocaleString();

/** 一趟扫描的结论：来源一行，每个来源一张读数卡；要清的三样一行。 */
function ScanResult({ scan, partial = false }: { scan: ResourceScanState; partial?: boolean }) {
  const cache = scan.cache ?? { files: 0, bytes: 0 };
  return (
    <>
      <div className={RESULT_ROW}>
        {(scan.sources ?? []).map((source) => (
          <article key={source.location} className={plainStatClass()}>
            <PlainStat label={SOURCE_LABELS[source.location] || "미디어 소스"}
              mark={<SourceMark mark={MEDIA_SOURCE_ICONS[source.location] ?? 'database'} />}
              aside={<span className={source.online ? 'text-notification-success-foreground' : 'text-text-error-primary'}>
                {source.online ? "접근 가능" : "오프라인으로 건너뜀"}
              </span>}
              figure={source.online ? `${count(source.missing)} 개` : '—'}
              meta={sourceMeta(source)} wrapMeta />
          </article>
        ))}
      </div>
      {!partial && <div className={RESULT_ROW}>
        <article className={plainStatClass()}>
          <PlainStat label="영구 삭제 예정" figure={`${count(purgeCount(scan))} 개`} meta="휴지통을 포함해 파일이 디스크에 없음" />
        </article>
        <article className={plainStatClass()}>
          <PlainStat label="파일 없음으로 표시 예정" figure={`${count(scan.vanish)} 개`} meta="개인 기록이 있어 기록 유지" />
        </article>
        <article className={plainStatClass()}>
          <PlainStat label="빈 폴더" figure={`${count(scan.empty)} 개`} meta="소스 루트 폴더 유지" />
        </article>
        <article className={plainStatClass()}>
          <PlainStat label="정리 가능한 캐시" figure={`${count(cache.files)} 개`}
            meta={cache.files ? fmtSize(cache.bytes) : ''} />
        </article>
      </div>}
    </>
  );
}

export function ResourceSyncCard(
  { toast }: { toast(message: string, options?: { warning?: boolean }): void },
) {
  const apply = useBackgroundJob<ResourceApplyState, string>({
    queryKey: RESOURCE_APPLY_KEY,
    queryFn: ({ signal }) => fetchResourceApply(signal),
    start: startResourceApply,
    onFinish: (out) => {
      /* 回收站里的失效记录也一并删了：顶上那张回收站读数跟着重取。检查那一份带上了 `applied`。 */
      void queryClient.invalidateQueries({ queryKey: TRASH_KEY, exact: true });
      void queryClient.invalidateQueries({ queryKey: RESOURCE_SCAN_KEY, exact: true });
      if (out.status !== 'complete') return;
      /* 没删的几样是这一轮留下的，能删的已经删了：报警告档、写完成与没处理的数目，不说失败。 */
      const { done, left } = applyLeftovers(out);
      if (left) toast(`완료 ${count(done)} 개 항목,${count(left)} 개 항목 미처리`, { warning: true });
      else toast("유효하지 않은 항목을 정리했습니다");
    },
  });
  const scan = useBackgroundJob<ResourceScanState>({
    queryKey: RESOURCE_SCAN_KEY,
    queryFn: ({ signal }) => fetchResourceScan(signal),
    start: startResourceScan,
    /* 又扫了一趟：上一趟清理的回执说的是旧清单。 */
    onStarted: () => apply.dismiss(),
  });

  const state = scan.job;
  const scanning = scan.running || scan.start.isPending;
  const cleaning = apply.running || apply.start.isPending;
  const scanned = state?.status === 'complete' || state?.status === 'failed';
  const label = scanning ? "스캔 중" : scanned ? "다시 스캔" : "파일 확인";

  /* 执行那一步只认这次检查的候选，逐条复核后再删；删了就没有撤销。 */
  const runApply = (payload: ResourceScanState) => void confirmModal({
    title: APPLY_LABEL,
    body: applyConfirmText(payload),
    confirmLabel: APPLY_LABEL,
    danger: true,
    onConfirm: () => apply.start.mutateAsync(payload.scan_id || ''),
  });

  const done = apply.outcome;
  const receipt = (out: ResourceApplyState) => {
    const partial = applyLeftovers(out).left > 0;
    return (
      <Note tone={partial ? 'warning' : 'success'} title={partial ? "일부 완료" : "정리 결과"}>
        {applyText(out, fmtSize)}
      </Note>
    );
  };
  let progress = null;
  let result = null;
  if (done?.status === 'failed') {
    result = <Note tone="error" title="리소스 정리가 완료되지 않았습니다">{done.error || "작업 기록에서 처리된 파일을 확인하세요."}</Note>;
  } else if (done) {
    result = receipt(done);
  } else if (apply.running) {
    progress = <TaskProgress embedded label={apply.job?.message || "유효하지 않은 항목을 재확인하고 정리하는 중…"} />;
  } else if (scan.start.isError) {
    result = <Note tone="error" title="스캔 실패">{errorMessage(scan.start.error)}</Note>;
  } else if (scan.query.isError && state) {
    result = <Note tone="neutral" title="작업 상태">{DISCONNECTED}</Note>;
  } else if (state?.status === 'running') {
    const line = scanLine(state);
    progress = (
      <TaskProgress embedded label={line} value={state.completed_sources} total={state.total_sources} />
    );
    if (state.sources?.length) result = <ScanResult scan={state} partial />;
  } else if (state?.status === 'failed') {
    result = <>
      {state.sources?.length ? <ScanResult scan={state} partial /> : null}
      <Note tone="error" title="스캔 실패">{state.error || "백그라운드 스캔 실패"}</Note>
    </>;
  } else if (state?.status === 'complete' && state.applied) {
    result = apply.job?.status === 'complete'
      ? receipt(apply.job)
      : <Note tone="neutral" title="정리 결과">이번 검사 결과의 정리가 완료되었습니다. 다시 스캔하면 재확인할 수 있습니다.</Note>;
  } else if (state?.status === 'complete') {
    const changes = hasChanges(state);
    result = (
      <>
        <ScanResult scan={state} />
        {changes ? <Note tone="neutral" title="정리 대상">{applyPlanText(state)}</Note> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {changes
            ? <Button variant="danger" {...busyProps(cleaning)} onClick={() => runApply(state)}>
                {cleaning ? "재확인하고 정리하는 중…" : APPLY_LABEL}
              </Button>
            : <p className="mr-auto text-body-regular text-notification-success-foreground">
                접근 가능한 소스를 확인했습니다. 정리할 기록, 빈 폴더 또는 캐시가 없습니다.
              </p>}
        </div>
      </>
    );
  }
  if (apply.start.isError && !done) {
    result = <>{result}<Note tone="error" title="정리 실패">{errorMessage(apply.start.error)}</Note></>;
  }

  return (
    <section id="resource-sync" aria-labelledby="resource-sync-title" className="flex scroll-mt-20 flex-col gap-4">
      <Fieldset layout="split" labelledBy="resource-sync-title" footer={
        <Button data-resource-scan leadingIcon={scanned && !scanning ? AGAIN : COMPARE} {...busyProps(scanning)}
          onClick={() => { if (!scanning) scan.start.mutate() }}>{label}</Button>
      }>
        <FieldsetTitle id="resource-sync-title" gap="small">리소스 동기화</FieldsetTitle>
        <p className="max-w-190 text-body-2-regular leading-5 text-text-secondary">
          컬렉션 기록별로 로컬 디스크와 클라우드 드라이브의 파일을 찾아, 파일이 사라진 기록과 빈 폴더, 더 이상 참조되지 않는 캐시를 표시합니다.
        </p>
        <div aria-live="polite" className="mt-4 empty:hidden">{progress}</div>
      </Fieldset>
      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">{result}</div>
    </section>
  );
}

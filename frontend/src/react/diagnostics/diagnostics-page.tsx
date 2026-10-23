import { koreanLabel } from '../../korean-label';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { SettingsCard, SettingsSectionLabel } from '@/components/application/settings/settings-rows';
import { cx } from '@/utils/cx';
import { errorMessage } from '../../api';
import { diagnosticsSkeleton } from '../../diagnostics-skeleton';
import { ErrorExcerpt } from '../activity/error-excerpt';
import { Note } from '../components/note';
import { SiteMark } from '../components/site-mark';
import { Disclosure, Fact, FactList, Section, Stack } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import { DIAGNOSTICS_KEY, fetchDiagnostics, type DiagnosticCheck } from './diagnostics';
import { HealthList } from './health-list';

const STATUS: Record<string, string> = { ok: "정상", warning: "확인 필요", failed: "조치 필요", unknown: "가져오지 못함", disabled: "미설정",
  stale: "재확인 대기", unchecked: "아직 기록 없음" };
const TARGET_LABELS: Record<string, string> = {
  '/settings/network': "네트워크 및 접근 열기", '/settings/maintenance': "유지 관리 및 업데이트 열기", '/tasks': "작업 보기",
};
const SECTIONS = [
  ["미디어 라이브러리 및 마운트", ['media_mounts', 'data_root']],
  ["데이터베이스 및 마이그레이션", ['database', 'schema']],
  ["도구", ['ffmpeg']],
  ["설정 및 접근", ['configured', 'security', 'port', 'version']],
  ["백그라운드 작업", ['tasks']],
] as const;
const moment = (value: string) => new Date(value).toLocaleString();

function DiagnosticStatus({ status }: { status: string }) {
  return <Chip variant="caption" data-diagnostic-status={status}
    color={status === 'failed' ? 'rose' : status === 'warning' || status === 'stale' ? 'yellow' : 'neutral'}>
    {STATUS[status] ?? "가져오지 못함"}
  </Chip>;
}

export interface DiagnosticsProps {
  navigate(path: string): void; configure(section: string): void; openItem(id: number): void;
  receipt(message: string): void;
}

function DownloadReport() {
  const action = useAction();
  const download = () => void action.run('download', async () => {
    const response = await fetch('/api/diagnostics/bundle', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`진단 보고서 다운로드 실패(HTTP ${response.status}）`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'peach-support.zip';
    document.body.append(anchor);
    try { anchor.click() } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, () => {});
  return <div className="flex flex-col items-end gap-2">
    <Button variant="secondary" onClick={download} {...busyProps(action.busy === 'download')}>진단 보고서 다운로드</Button>
    {action.error ? <Note tone="error">{action.error}</Note> : null}
  </div>;
}

function Check({ name, check, navigate, configure, compact = false }: Pick<DiagnosticsProps, 'navigate' | 'configure'> & {
  name: string; check: DiagnosticCheck; compact?: boolean;
}) {
  const section = name === 'security' || name === 'port' ? '网络与访问' : '媒体库与入库';
  const Heading = compact ? 'h4' : 'h3';
  return <div data-diagnostic-check={name} className={cx('flex flex-col gap-4 border-b border-separator-border pr-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between', compact ? 'py-3' : 'py-5')}>
    <div className={cx('flex min-w-0 flex-1 flex-col', compact ? 'gap-1' : 'gap-2')}>
      <div className="flex flex-wrap items-center gap-3">
        <Heading className={cx('text-text-primary', compact ? 'text-body-2-medium' : 'text-body-medium')}>{check.label}</Heading>
        <DiagnosticStatus status={check.status} />
      </div>
      <p data-check-reason className={cx('text-body-2-regular break-words', compact ? 'text-text-secondary' : 'text-text-primary')}>{check.reason}</p>
      {check.action ? <p className="text-body-2-regular text-text-secondary">권장 조치:{check.action}</p> : null}
    </div>
    {check.target ? <div className="shrink-0 self-end sm:self-auto"><Button size="small" variant="secondary" onClick={() => check.target === '/settings/library'
      ? configure(section) : navigate(check.target!)}>{check.target === '/settings/library'
        ? `열기:${koreanLabel(section)}` : TARGET_LABELS[check.target] ?? "관련 페이지 열기"}</Button></div> : null}
  </div>;
}

export function DiagnosticsPage(props: DiagnosticsProps) {
  const query = useQuery({ queryKey: DIAGNOSTICS_KEY, queryFn: ({ signal }) => fetchDiagnostics(signal), staleTime: 10_000 });
  const action = useAction();
  const [refreshError, setRefreshError] = useState('');
  const refresh = () => void action.run('refresh', async () => {
    const response = await query.refetch();
    if (response.error) throw response.error;
    return response.data;
  }, () => setRefreshError(''), cause => setRefreshError(errorMessage(cause)));
  const data = query.data;
  if (!data && query.isPending) return <div role="status" aria-label="시스템 진단을 읽는 중" dangerouslySetInnerHTML={{ __html: diagnosticsSkeleton() }} />;
  if (!data) return <div className="ui-configpage"><DownloadReport /><Note tone="error" title="진단을 읽지 못했습니다"
    action={<Button variant="secondary" onClick={refresh} {...busyProps(action.busy === 'refresh')}>다시 확인</Button>}>
    {query.error ? errorMessage(query.error) : "진단 보고서를 가져오지 못했습니다."}
  </Note></div>;
  const attention = Object.entries(data.checks).filter(([, check]) => ['warning', 'failed', 'unknown'].includes(check.status));
  const other = Object.entries(data.checks).filter(([, check]) => !['warning', 'failed', 'unknown'].includes(check.status));
  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap justify-end gap-2"><DownloadReport />
      <Button variant="secondary" onClick={refresh} {...busyProps(action.busy === 'refresh')}>다시 확인</Button></div>
    {refreshError ? <Note tone="error">{refreshError}</Note> : null}
    {attention.length ? <Section title={`주의 필요 · ${attention.length} 개`}>
      {attention.map(([key, check]) => <Check key={key} name={key} check={check} {...props} />)}
    </Section> : null}
    <Section title="라이브러리 상태"><Stack>
      {data.library.issue_at ? <p className="text-body-2-regular text-text-secondary">처리 기록 · {moment(data.library.issue_at)}</p> : null}
      {Object.entries(data.library.groups).map(([key, group]) => <HealthList key={key} group={group} {...props} />)}
    </Stack></Section>
    {other.length ? <section aria-label="시스템 검사">
      <Disclosure summary={`기타 검사 · ${other.length} 개`} contentClassName="gap-5">
        {SECTIONS.map(([title, keys]) => {
          const rows = other.filter(([key]) => keys.some(name => name === key));
          return rows.length ? <section key={title} aria-label={title} data-diagnostic-group="" className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center gap-2 px-3 text-body-medium text-text-primary">{title}
              <span className="text-caption-1-regular text-text-secondary">{rows.length} 개</span>
            </h3>
            <SettingsCard>{rows.map(([key, check]) => <Check key={key} name={key} check={check} compact {...props} />)}</SettingsCard>
          </section> : null;
        })}
      </Disclosure>
    </section> : null}
    <section aria-label="소스 세션" className="flex min-w-0 flex-col gap-3">
      <SettingsSectionLabel>소스 세션</SettingsSectionLabel>
      {data.sources.map(source => <article key={source.source} data-diagnostic-source={source.source}>
        <SettingsCard><Stack>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-body-medium text-text-primary"><SiteMark source={source.source} />{source.label}</h3>
          <DiagnosticStatus status={source.status} />
        </div>
        {/* 原因常是整段堆栈：平时只露异常那一行，全文收在「查看详情」后面。 */}
        <ErrorExcerpt text={source.reason} className="text-body-regular text-text-primary" />
        <FactList>
          <Fact term="최근 분석 성공">{source.last_success_at ? moment(source.last_success_at) : "성공 기록 없음"}</Fact>
          {source.last_check_at ? <Fact term="최근 확인">{moment(source.last_check_at)}
            {source.elapsed_s !== undefined && source.elapsed_s !== null ? ` · ${source.elapsed_s.toFixed(2)} 초` : ''}</Fact> : null}
          <Fact term="대기 종료 시각">{source.cooldown_until ? moment(source.cooldown_until) : "대기 중 아님"}</Fact>
        </FactList>
        </Stack></SettingsCard>
      </article>)}
      <div><Button size="small" variant="secondary" onClick={() => props.navigate('/sources')}>소스 및 인증 정보 열기</Button></div>
    </section>
  </div>;
}

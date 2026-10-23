import { koreanLabel } from '../../korean-label';
/* 检查更新：当前与最新版本、下载安装进度，准备好之后确认重启。
 *
 * 更新任务进行中每秒问一次状态，空闲时 30 秒一次；连续 120 次问不到就停下并说明原因。 */
import { useEffect, useRef, useState } from 'react';
import { confirmModal } from '@peach/legacy/ui';

import { Button } from '@/components/base/buttons/button';

import { apiGet, apiSend, errorMessage } from '../../api';
import type { ReleaseState, UpdateJob } from '../bundle';
import { Note } from '../components/note';
import { Progress } from '../components/progress';
import { ErrorText, ExternalLink, Fact, FactList, Footer, Help, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

const ACTIVE = new Set(['downloading', 'verifying', 'extracting', 'preparing', 'restarting', 'installing']);
const STOPS = [65, 75, 90];
const MAX_FAILURES = 120;

export function ReleaseUpdates({ initial, initialJob }: { initial: ReleaseState; initialJob?: UpdateJob | undefined }) {
  const [data, setData] = useState(initial);
  const [job, setJob] = useState<UpdateJob>(initialJob || { state: 'idle', progress: 0 });
  const [pollError, setPollError] = useState('');
  const action = useAction();
  const prompted = useRef(false);
  const mounted = useRef(true);
  const running = ACTIVE.has(job.state);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const restart = async () => {
    const result = await apiSend<UpdateJob>('/api/configuration/update-restart', {});
    if (mounted.current) setJob(result);
  };
  const confirmRestart = () => void confirmModal({
    title: "업데이트 준비 완료", body: `Peach ${job.version || ''} 버전은 다시 시작한 후 설치됩니다.`,
    confirmLabel: "지금 다시 시작", cancelLabel: "나중에", onConfirm: restart,
  });

  useEffect(() => {
    if (job.state !== 'ready' || prompted.current) return;
    prompted.current = true;
    confirmRestart();
  }, [job.state]);

  useEffect(() => {
    const controller = new AbortController();
    const delay = ACTIVE.has(job.state) ? 1000 : 30000;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const result = await apiGet<UpdateJob>('/api/configuration/update-status', controller.signal);
        if (controller.signal.aborted) return;
        setJob(result);
        failures = 0;
        if (result.state === 'complete') {
          setData((current) => ({ ...current, current_version: result.version || current.current_version, state: 'current', message: "최신 테스트 버전입니다." }));
        }
        const automatic = await apiGet<{ result?: ReleaseState }>('/api/configuration/automatic-updates', controller.signal);
        if (!controller.signal.aborted && automatic.result) setData(automatic.result);
      } catch {
        failures += 1;
        if (failures >= MAX_FAILURES && !controller.signal.aborted) setPollError("아직 Peach에 연결되지 않았습니다. 트레이를 확인한 후 페이지를 새로 고치세요.");
      }
      if (!controller.signal.aborted && failures < MAX_FAILURES) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job.state]);

  const download = () => {
    if (running) return;
    prompted.current = false;
    setPollError('');
    void action.run('download', (signal) => apiSend<UpdateJob>('/api/configuration/update', {}, 'POST', signal), setJob);
  };
  const check = () => void action.run('check', (signal) => apiGet<ReleaseState>('/api/configuration/updates', signal), setData,
    (cause) => { setData({ ...initial, state: 'error' }); action.setError(errorMessage(cause)); });

  const error = action.error || pollError;
  const reading = job.state === 'downloading' && job.total
    ? `${((job.downloaded || 0) / 1048576).toFixed(1)} / ${(job.total / 1048576).toFixed(1)} MB`
    : `${job.progress}%`;
  return (
    <Section title="업데이트 확인">
      <FactList>
        <Fact term="현재 버전">{data.current_version}</Fact>
        <Fact term="설치 방식">{koreanLabel(data.installation)}</Fact>
        <Fact term="업데이트 채널">{data.channel}</Fact>
        <Fact term="최신 버전">{data.latest_version || (data.state === 'unchecked' ? "아직 확인하지 않음" : "가져오지 못함")}</Fact>
        {data.package_kind ? <Fact term="다운로드 내용">
          {data.package_kind === 'update' ? "앱 업데이트 패키지" : "앱 및 도구"}
          {data.asset_size ? ` · ${(data.asset_size / 1048576).toFixed(1)} MB` : ''}
        </Fact> : null}
      </FactList>
      {data.package_kind === 'update'
        ? <Help>앱 업데이트 패키지는 설치된 도구를 재사용합니다. 도구가 없거나 손상되었거나 버전이 바뀌면 필요한 도구 패키지를 별도로 다운로드합니다.</Help>
        : data.package_kind === 'full' ? <Help>이번 업데이트에는 미디어 도구가 포함되어 있습니다.</Help> : null}
      {/* 还没检查过时「最新版本」那一行已经写着「尚未检查」，下面不再说一遍。 */}
      {data.state === 'unchecked' && !data.checked_at && !error && job.state === 'idle' ? null : <Stack divided>
        {data.checked_at ? <Help>확인 시각: {new Date(data.checked_at * 1000).toLocaleString()}</Help> : null}
        {data.state === 'available' && !error
          ? <Note tone="info" title="업데이트 가능">{data.message}</Note>
          : error || data.state === 'error'
            ? <ErrorText>{error || data.message}</ErrorText>
            : data.state === 'unchecked' ? null : <Help role="status">{data.message}</Help>}
        {job.state === 'error' ? <ErrorText>{job.message}</ErrorText> : null}
        {job.state !== 'idle' && job.state !== 'error' ? (
          <div aria-live="polite" className="flex flex-col gap-2">
            <Progress label="업데이트 준비 진행률" value={job.progress} stops={STOPS} />
            <Help>다운로드 → 검증 → 압축 해제 → 설치 준비 · {job.message}</Help>
            <Help>{reading}</Help>
          </div>
        ) : null}
      </Stack>}
      <Footer status={<ExternalLink href={data.release_url}>릴리스 페이지 보기</ExternalLink>}>
        {job.state === 'ready' ? <Button onClick={confirmRestart}>다시 시작하여 설치</Button> : null}
        {data.state === 'available' && data.installation === '独立测试包' && job.state !== 'ready'
          ? <Button onClick={download} {...busyProps(running || action.busy === 'download')}>다운로드 및 설치</Button>
          : null}
        <Button variant={job.state === 'ready' || (data.state === 'available' && data.installation === '独立测试包') ? 'secondary' : 'primary'}
          disabled={running} onClick={check} {...busyProps(action.busy === 'check')}>업데이트 확인</Button>
      </Footer>
    </Section>
  );
}

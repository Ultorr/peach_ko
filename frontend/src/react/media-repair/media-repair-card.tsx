/* 数据管理页上的「媒体修复」卡片：选一个媒体库，把里面播不了或播不顺的 MP4 批量修好。
 *
 * 卡片和「扫描与采集」同一副形状：左边讲这件事和此刻的进度，页脚放媒体库与起停键；
 * 这一趟的下场挂在卡片外面。跑动时两秒问一次，空闲时不问。 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { confirmModal, MEDIA_SOURCE_ICONS } from '@peach/legacy/ui';

import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';

import { apiSend } from '../../api';
import { koreanLabel } from '../../korean-label';
import { REPAIR_CARD_TEXT } from '../../management';
import { JOB_RUNNING_POLL_MS } from '../background-job';
import { Fieldset, FieldsetTitle } from '../components/fieldset';
import { Note } from '../components/note';
import { Progress } from '../components/progress';
import { queryClient } from '../query';
import { SourceMark } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import {
  fetchMediaRepair, fetchRepairLibraries, IDLE_REPAIR, MEDIA_REPAIR_KEY, MEDIA_REPAIR_URL,
  missingToolText, REPAIR_LIBRARIES_KEY, statusLine, type MediaRepairState,
} from './media-repair';

const libraryMark = (icon: string) => MEDIA_SOURCE_ICONS[icon] || icon;
const replace = (next: MediaRepairState) => queryClient.setQueryData(MEDIA_REPAIR_KEY, next);

export function MediaRepairCard() {
  const repair = useQuery({
    queryKey: MEDIA_REPAIR_KEY, queryFn: ({ signal }) => fetchMediaRepair(signal),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? JOB_RUNNING_POLL_MS : false),
  });
  const choices = useQuery({
    queryKey: REPAIR_LIBRARIES_KEY, queryFn: ({ signal }) => fetchRepairLibraries(signal),
  });
  const [chosen, setChosen] = useState('');
  const action = useAction();
  const state = repair.data ?? IDLE_REPAIR;
  const libraries = choices.data ?? [];
  const running = state.status === 'running';

  // 跑着的那一轮握着下拉框；空闲时是人选的那个，没选过就是上一轮修的库，再没有就是第一个。
  const selected = libraries.find((row) => row.id === (running ? state.library : chosen))
    ?? libraries.find((row) => row.id === state.library) ?? libraries[0];

  const start = () => {
    if (!selected) return;
    void confirmModal({
      title: `미디어 라이브러리 복구 「${selected.name}」`,
      body: "타임스탬프 테이블이 없는 영상은 복구한 헤더를 별도로 저장하고 원본은 유지합니다. 인덱스가 없는 영상은 재구성한 파일로 원본을 교체하며, "
        + "손상된 원본은 같은 폴더의 숨김 파일(.파일명.peach-original)로 이름을 바꾸어 보관합니다."
        + (selected.metered ? " 이 라이브러리는 종량제 소스에 있으므로 영상 하나를 복구할 때마다 전체 파일을 한 번 다운로드합니다." : ''),
      confirmLabel: "미디어 라이브러리 복구",
      onConfirm: async () => replace(await apiSend<MediaRepairState>(MEDIA_REPAIR_URL,
        { library: selected.id, restart: true })),
    });
  };
  const stop = () => void action.run('stop',
    (signal) => apiSend<MediaRepairState>(MEDIA_REPAIR_URL, { stop: true }, 'POST', signal), replace);

  const line = statusLine(state);
  const complete = state.status === 'complete';
  const problem = action.error || state.error || (repair.error ? "미디어 복구 상태를 불러올 수 없습니다" : '');
  return (
    <div className="flex flex-col gap-4">
      <Fieldset layout="split" label="미디어 복구" footer={
        <>
          <Select aria-label="미디어 라이브러리" className="w-48" selectedKey={selected?.id ?? null}
            isDisabled={running || !libraries.length}
            onSelectionChange={(key) => { if (key !== null) setChosen(String(key)); }}>
            {libraries.map((row) => (
              <SelectItem key={row.id} id={row.id} textValue={row.name}>
                <SourceMark mark={libraryMark(row.icon)} />{row.name}
              </SelectItem>
            ))}
          </Select>
          {running
            ? <Button onClick={stop} {...busyProps(action.busy === 'stop')}>중지</Button>
            : <Button onClick={start} disabled={!selected}>복구 시작</Button>}
        </>
      }>
        <div className="flex flex-col gap-2">
          <FieldsetTitle>미디어 복구</FieldsetTitle>
          <p className="text-body-2-regular text-text-secondary">{REPAIR_CARD_TEXT}</p>
          {running && state.total
            ? <Progress label="복구 진행 상황" value={state.checked} max={state.total} />
            : null}
          {line ? <p role="status" className="text-caption-1-regular text-text-secondary">{line}</p> : null}
        </div>
      </Fieldset>
      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {complete && !state.repaired && !state.failed
          ? <Note tone="info" title="복구할 항목이 없습니다">이 라이브러리의 모든 영상을 바로 재생할 수 있습니다.</Note>
          : null}
        {complete && state.missing_tool
          ? <Note tone="warning" title="untrunc 없음">{missingToolText(state)}</Note>
          : null}
        {problem ? <Note tone="error">{koreanLabel(problem)}</Note> : null}
      </div>
    </div>
  );
}

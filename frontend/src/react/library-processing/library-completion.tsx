import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cardArtwork } from '@peach/card-art';

import { LinkButton } from '@/components/base/buttons/link-button';
import { RiArrowRightLine } from '@remixicon/react';

import { apiSend, errorMessage } from '../../api';
import type { MediaItem } from '../catalog-grid/types';
import { Note } from '../components/note';
import { queryClient } from '../query';
import {
  DISCONNECTED_TEXT, fetchLibraryProcessing, LIBRARY_PROCESSING_KEY, LIBRARY_PROCESSING_URL,
  pollInterval, processingActive, processingError, type LibraryProcessingCommand, type LibraryProcessingData,
} from './library-processing';
import { ProcessingActions } from './processing-actions';

/** 缺图判据与卡面一致；本机影片可抽帧，有番号的挂载影片可补发行封面。 */
type PreviewItem = Pick<MediaItem, 'id' | 'name' | 'medium' | 'disposal' | 'location' | 'code' | 'is_jav'
  | 'has_cover' | 'cover_key' | 'has_thumb' | 'has_local_poster' | 'follow_thumb_url'>;

export function missingPreviewIds(items: PreviewItem[], javImage: string): number[] {
  return [...new Set(items.filter(item => (!item.medium || item.medium === 'video')
    && (!/\.(strm|iso)$/i.test(item.name || '') || !!item.code)
    && !item.disposal && item.location !== 'online' && (item.location === 'local' || !!item.code)
    && !cardArtwork(item, 'small', false, javImage).html).map(item => item.id))];
}

export function LibraryCompletionPrompt({ assetIds, onComplete }: { assetIds: number[]; onComplete?(): void }) {
  return assetIds.length ? <Completion assetIds={assetIds} onComplete={onComplete} /> : null;
}

function Completion({ assetIds, onComplete }: { assetIds: number[]; onComplete?(): void }) {
  const job = useQuery({ queryKey: LIBRARY_PROCESSING_KEY,
    queryFn: ({ signal }) => fetchLibraryProcessing(signal),
    refetchInterval: query => pollInterval(query.state.data, true) });
  const [started, setStarted] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const completed = useRef<string | null>(null);
  const start = useMutation({
    mutationFn: (command: LibraryProcessingCommand) =>
      apiSend<LibraryProcessingData>(LIBRARY_PROCESSING_URL, { ...command, asset_ids: assetIds }),
    onSuccess: next => {
      setStarted(next.job_id || null);
      queryClient.setQueryData(LIBRARY_PROCESSING_KEY, next);
      void queryClient.invalidateQueries({ queryKey: LIBRARY_PROCESSING_KEY });
    },
  });
  const state = job.data;
  useEffect(() => {
    if (!state || !started || state.job_id !== started || processingActive(state)
      || completed.current === started) return;
    completed.current = started;
    if (state.status === 'complete') {
      setOutcome(`보완 완료: 표지 ${state.covers || 0} 장 가져옴, 동영상 미리보기 ${state.previews || 0} 개 생성.`);
    }
    void queryClient.invalidateQueries({ queryKey: ['catalog-grid'] });
    onComplete?.();
  }, [state, started, onComplete]);
  // 运行中的进度与控制由常驻任务卡承接，缺图提示只在可发起补全时呈现。
  if (processingActive(state)) return null;
  const busy = start.isPending || processingActive(state);
  const problem = start.error ? errorMessage(start.error) : job.error ? DISCONNECTED_TEXT
    : started && state?.job_id === started && state.status === 'failed' ? processingError(state.error || "보완 미완료") : '';
  const message = problem || (start.isPending ? "보완 작업 시작 중…"
    : outcome || `이 영상 묶음 중 ${assetIds.length.toLocaleString()} 개에 미리보기가 없습니다. 정보와 이미지를 보완할 수 있습니다.`);
  return <section aria-label="미리보기 보완" aria-live="polite" data-library-completion="" className="@container mb-4">
    <Note tone={problem ? 'warning' : 'neutral'} actionLayout="below" action={<div className="flex flex-wrap items-center gap-2"><ProcessingActions busy={busy} metadataOnly={state?.metadata_only} onRun={command => {
      if (busy) return;
      setOutcome('');
      start.mutate(command);
    }} /></div>}>
      {message}{' '}<LinkButton href="/data-cleanup#libraryProcessing" size="small" trailingIcon={RiArrowRightLine}>
      {problem ? "확인 및 처리" : "처리 세부 정보 보기"}
    </LinkButton></Note>
  </section>;
}

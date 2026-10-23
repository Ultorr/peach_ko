import type { CSSProperties, RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { fmtDur, requestErrorMessage } from '@peach/legacy/core';
import { spinnerHtml } from '@peach/legacy/ui';
import type { MediaItem } from '../catalog-grid/types';
import { busyProps } from '../settings/busy-props';
import { useWallPlayback } from './use-wall-playback';
import { WALL_CONTROLS_REVEAL } from './wall-motion';

/** 时间更新只重画控制条，海报和块内布局保持挂载。 */
export function WallControls({ item, playing, frame, starting, pendingGroup, grouped, queueOpen, queueReady,
  hasPrevious, hasNext, later, laterBusy, play, previous, next, queue, watchLater, details, ended, error }: {
  item: MediaItem; playing: number | null; frame: RefObject<HTMLDivElement | null>;
  starting: boolean; pendingGroup: boolean; grouped: boolean; queueOpen: boolean; queueReady: boolean;
  hasPrevious: boolean; hasNext: boolean; later: boolean; laterBusy: boolean;
  play(): Promise<void>; previous(): void; next(): void; queue(): void; watchLater(): void; details(): void;
  ended(): void; error(message: string): void;
}) {
  const reduce = useReducedMotion();
  const transport = useWallPlayback(playing, frame, ended);
  const duration = transport.duration || Number(item.duration) || 0;
  const busy = starting || pendingGroup, paused = !playing || transport.paused;
  const toggle = async () => {
    if (busy || (grouped && !queueReady)) return;
    try { if (playing === item.id) await transport.toggle(); else await play() }
    catch (failure) { error(requestErrorMessage(failure)) }
  };
  return <motion.div data-wall-focus-actions="" initial={reduce ? false : { opacity:0, transform:'translateY(12px)' }}
    animate={{ opacity:1, transform:'translateY(0px)' }} transition={reduce ? { duration:0 } : WALL_CONTROLS_REVEAL}>
    <div data-wall-control-row="">
      <button type="button" data-wall-play="" data-wall-pause={!paused ? '' : undefined} {...busyProps(busy)}
        aria-label={starting ? "여는 중" : pendingGroup ? "버전을 읽는 중" : paused ? "재생" : "일시 정지"}
        title={paused ? "재생" : "일시 정지"} onClick={() => void toggle()}>
        {busy ? <span dangerouslySetInnerHTML={{ __html:spinnerHtml() }} /> : <svg viewBox="0 0 24 24" aria-hidden="true"><use href={paused ? '#i-play' : '#i-player-pause'} /></svg>}
      </button>
      <button type="button" aria-label="이전 동영상" title="이전 동영상" disabled={!hasPrevious} onClick={previous}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevron-left" /></svg></button>
      <button type="button" aria-label={grouped ? "분할 파일 또는 버전 전환" : "동영상 전환"} title={grouped ? "분할 파일 및 버전" : "항목 목록"}
        aria-expanded={queueOpen} aria-controls="wall-queue" disabled={!queueReady} onClick={queue}>
        <svg viewBox="10.4 10.5 259.2 259.2" aria-hidden="true"><use href="#i-playlist" /></svg>
      </button>
      <button type="button" aria-label="다음 동영상" title="다음 동영상" disabled={!hasNext} onClick={next}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevron-right" /></svg></button>
      <button type="button" {...busyProps(laterBusy)} aria-label={later ? "나중에 볼 목록에서 제거" : "나중에 보기"} title="나중에 보기" aria-pressed={later} onClick={watchLater}>
        {laterBusy ? <span dangerouslySetInnerHTML={{ __html:spinnerHtml() }} /> : <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-bookmark" /></svg>}
      </button>
      <span data-wall-time="">{transport.time > 0 ? fmtDur(transport.time) : '00:00'} / {duration > 0 ? fmtDur(duration) : '00:00'}</span>
      <button type="button" aria-label="상세 정보" title="상세 정보 열기" onClick={details}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-external-link" /></svg></button>
    </div>
    <input data-wall-seek="" type="range" aria-label="재생 진행률" min={0} max={duration || 1} step={.1} value={Math.min(transport.time, duration)}
      disabled={!playing || !transport.duration} onChange={event => transport.seek(Number(event.target.value))}
      style={{ '--wall-seek':`${duration ? Math.min(100, transport.time / duration * 100) : 0}%` } as CSSProperties} />
  </motion.div>;
}

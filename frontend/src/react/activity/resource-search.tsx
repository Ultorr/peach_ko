/* 搜索只选择候选；真正提交由云下载表单确认。 */
import { useEffect, useRef, useState } from 'react';
import { RiSearchLine } from '@remixicon/react';
import { spinnerHtml } from '@peach/legacy/ui';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { apiGet } from '../../api';
import { ErrorText, FieldLabel, Help } from '../settings/section';
import { useAction } from '../settings/use-action';
import { coverUrl } from '@peach/card-art';
import type { MediaPage } from '../catalog-grid/types';
import type { DownloadPrefill } from './cloud-download-dialog';
import { sameWorkCode } from './work-code';

interface Candidate {
  id: string; uri: string; name: string; size: number; seeders: number; origins: string[];
  resolution: number; codec: string; chinese: boolean; uncensored: boolean;
}
interface Result { state: string; items: Candidate[]; warnings: string[]; error: string }

function SearchSpinner({ className }: { className?: string }) {
  return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: spinnerHtml('') }} />;
}

function preferredGoal(reason: string | undefined): string {
  if (['中字', '中文字幕'].includes(reason?.trim() ?? '')) return 'chinese';
  if (['无码', '无码破解'].includes(reason?.trim() ?? '')) return 'uncensored';
  return 'quality';
}

export function ResourceSearch({ initialCode, reason, choose, onSearch, onWork }: {
  initialCode: string; reason?: string; choose(uri: string, code: string): void;
  onSearch?(code: string): void; onWork?(work: DownloadPrefill | null): void;
}) {
  const [code, setCode] = useState(initialCode);
  const [goal, setGoal] = useState(() => preferredGoal(reason));
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [searched, setSearched] = useState('');
  const [selected, setSelected] = useState('');
  const action = useAction();
  const metadataRequest = useRef<AbortController | null>(null);
  useEffect(() => () => metadataRequest.current?.abort(), []);
  const search = () => {
    if (!code.trim() || action.busy) return;
    const query = new URLSearchParams({ code: code.trim(), goal });
    if (min) query.set('min_size', String(Math.round(Number(min) * 1024 ** 3)));
    if (max) query.set('max_size', String(Math.round(Number(max) * 1024 ** 3)));
    setResult(null);
    setSelected('');
    const requested = code.trim();
    onSearch?.(requested);
    metadataRequest.current?.abort();
    void action.run('search', (signal) => apiGet<Result>(`/api/resources/search?${query}`, signal), (next) => {
      setResult(next);
      setSearched(requested);
    });
    if (onWork) {
      const controller = new AbortController();
      metadataRequest.current = controller;
      void apiGet<MediaPage>(`/api/items?jav=1&q=${encodeURIComponent(requested)}&limit=10`, controller.signal).then(page => {
        if (controller.signal.aborted) return;
        const item = (page.items || []).find(row => sameWorkCode(row.code, requested));
        onWork(item ? { code: item.code, title: String(item.catalog_title || item.name || ''), performers: item.performers?.join('、'),
          release_date: String(item.release_date || ''), duration: item.duration, studio: item.studio,
          cover: item.has_cover ? coverUrl(item, true) : '', origin: `asset:${item.id}` } : null);
      }, () => { if (!controller.signal.aborted) onWork(null) });
    }
  };
  return (
    <section aria-label="리소스 찾기" aria-busy={Boolean(action.busy)} className="flex min-w-0 flex-col gap-4">
      {reason ? <Help>목표 버전: {reason}. 아래에서 검색 우선순위를 조정할 수 있습니다. 완전성과 워터마크는 각 결과를 직접 확인하세요.</Help> : null}
      <Input label="품번으로 리소스 찾기" value={code} maxLength={80} placeholder="품번을 입력하고 Enter를 누르세요" enterKeyHint="search"
        leadingIcon={action.busy ? SearchSpinner : RiSearchLine}
        isReadOnly={Boolean(action.busy)} aria-busy={Boolean(action.busy)} onChange={setCode} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); search() }
        }} />
      <div className="flex flex-col gap-1">
        <FieldLabel>우선 검색</FieldLabel>
        <Select aria-label="우선 검색" selectedKey={goal} isDisabled={Boolean(action.busy)}
          onSelectionChange={(key) => { if (key !== null) setGoal(String(key)) }}>
          <SelectItem id="quality">고화질</SelectItem><SelectItem id="chinese">중국어 자막</SelectItem>
          <SelectItem id="uncensored">무수정</SelectItem>
        </Select>
      </div>
      <div className="flex gap-3 max-sm:flex-col">
        <Input label="최소 크기 (GiB)" inputMode="decimal" value={min} onChange={setMin} />
        <Input label="최대 크기(GiB)" inputMode="decimal" value={max} onChange={setMax} />
      </div>
      {action.busy ? <Help role="status">리소스를 검색하는 중</Help> : null}
      {action.error ? <ErrorText>{action.error}</ErrorText> : null}
      {result?.error ? <Help role="status">{result.error}</Help> : null}
      {result?.state === 'ready' && !result.items.length ? <Help role="status">조건에 맞는 리소스가 없습니다.</Help> : null}
      {result?.warnings.map((warning) => <Help key={warning}>{warning}</Help>)}
      {result?.items.length ? <ul className="flex min-w-0 flex-col gap-4">
        {result.items.map((item) => <li key={item.id} className="flex min-w-0 flex-col gap-2 border-t border-separator-border pt-4">
          <p className="break-words text-body-2-medium text-text-primary">{item.name}</p>
          <Help>{[item.size > 0 ? `${(item.size / 1024 ** 3).toFixed(2)} GiB` : "크기 확인 불가", item.seeders >= 0 ? `${item.seeders} 개의 시드` : "시드 수 확인 불가",
            item.resolution ? `${item.resolution}p` : '', item.codec, item.chinese ? "중국어 자막" : '',
            item.uncensored ? "무수정" : '', item.origins.join('、')].filter(Boolean).join(' · ')}</Help>
          <div><Button type="button" variant="secondary" onClick={() => {
            choose(item.uri, searched); setSelected(item.id);
          }}>{selected === item.id ? "마그넷 링크 입력됨" : "이 리소스 사용"}</Button></div>
        </li>)}
      </ul> : null}
    </section>
  );
}

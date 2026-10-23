/* 资源查找弹层：JAV、想要与高清版目标共用搜索、作品资料和下载提交。
 * 下载配置在弹层打开时读取；已提交的任务在活动页查看。 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Heading } from 'react-aria-components';
import { RiCloseLine } from '@remixicon/react';

import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';

import { apiGet, apiSend, errorMessage } from '../../api';
import type { DownloadProviderKey, DownloadsSnapshot, DownloadSubmitResult } from '../bundle';
import { ModalFrame } from '../components/modal-frame';
import { Note } from '../components/note';
import { ErrorText, FieldLabel, Help } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import { DOWNLOADS_KEY, DOWNLOADS_URL, downloadPollInterval, failureText } from './downloads-panel';
import { ResourceSearch } from './resource-search';
import { sameWorkCode } from './work-code';
import { SourceLabel } from '../components/source-label';

/** 入口带进来的上下文。`origin` 记在任务上，如 `asset:12`、`wishlist:5`。 */
export interface DownloadPrefill { code?: string; title?: string; origin?: string; searchReason?: string;
  cover?: string; performers?: string; release_date?: string; duration?: number | null; studio?: string }

const RECEIPTS: Partial<Record<DownloadSubmitResult['outcome'], string>> = {
  submitted: "오프라인 다운로드를 요청했습니다. 작업 센터에서 진행 상황을 확인하세요",
  adopted: "이 마그넷 링크의 작업이 이미 있어 중복 요청하지 않았습니다",
  adopted_remote: "원격의 기존 작업을 연결했습니다",
};

export function CloudDownloadDialog({ prefill, close, receipt, provider }: {
  /** 空就是关着；不带番号与标题的空对象是「随手贴一条磁力」。 */
  prefill: DownloadPrefill | null;
  close(): void;
  receipt(message: string): void;
  /** 打开时先选中的下载方式，入库页把页上那一份交进来。 */
  provider?: string;
}) {
  return (
    <ModalFrame isOpen={Boolean(prefill)} onOpenChange={(open) => { if (!open) close() }} width="form">
      {prefill ? <Body prefill={prefill} close={close} receipt={receipt} provider={provider} /> : null}
    </ModalFrame>
  );
}

function Body({ prefill, close, receipt, provider }: {
  prefill: DownloadPrefill; close(): void; receipt(message: string): void; provider?: string;
}) {
  const query = useQuery({
    queryKey: DOWNLOADS_KEY,
    queryFn: ({ signal }) => apiGet<DownloadsSnapshot>(`${DOWNLOADS_URL}?limit=50`, signal),
    refetchInterval: (state) => downloadPollInterval(state.state.data),
  });
  const data = query.data;
  const header = (
    <div className="flex items-center justify-between gap-4 px-5 pt-5">
      <Heading slot="title" className="text-title-2-semibold text-text-primary">리소스 찾기</Heading>
      <Button variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="리소스 패널 닫기" onClick={close} />
    </div>
  );
  if (data) {
    return <SubmitForm header={header} snapshot={data} prefill={prefill} close={close} receipt={receipt} provider={provider} />;
  }
  return (
    <div className="flex min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {query.error ? <Note tone="error">{errorMessage(query.error)}</Note> : null}
      </div>
      <div className="flex justify-end p-3">
        <Button variant="secondary" onClick={close}>닫기</Button>
      </div>
    </div>
  );
}

function SubmitForm({ header, snapshot, prefill, close, receipt, provider: preferred }: {
  header: ReactNode; snapshot: DownloadsSnapshot; prefill: DownloadPrefill;
  close(): void; receipt(message: string): void; provider?: string;
}) {
  const client = useQueryClient();
  const configured = snapshot.providers.filter((row) => row.configured);
  const first = configured.find((row) => row.key === preferred) ?? configured[0];
  const [provider, setProvider] = useState<DownloadProviderKey>(first?.key || 'pikpak');
  const [magnet, setMagnet] = useState('');
  const [code, setCode] = useState(prefill.code ?? '');
  const [target, setTarget] = useState(first?.target || '');
  const [work, setWork] = useState<DownloadPrefill | null>(prefill.code ? prefill : null);
  const [failure, setFailure] = useState('');
  const usable = snapshot.available && configured.some(row => row.key === provider);
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);

  const choose = (key: DownloadProviderKey) => {
    setProvider(key);
    setTarget(configured.find((row) => row.key === key)?.target ?? '');
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!magnet.trim() || !usable) return;
    const body = { magnet, provider, target, code, title: work?.title, origin: work?.origin };
    setFailure('');
    void action.run('submit', (signal) => apiSend<DownloadSubmitResult>(DOWNLOADS_URL, body, 'POST', signal),
      (next) => {
        void client.invalidateQueries({ queryKey: DOWNLOADS_KEY });
        const text = RECEIPTS[next.outcome];
        if (next.ok && text) { receipt(text); close(); return }
        const reason = failureText(next.task);
        setFailure(next.outcome === 'refused' ? "이 리소스는 규정 위반으로 판정되어 다시 요청하지 않습니다."
          : reason ? `요청 실패: ${reason}` : "요청하지 못했습니다.");
      });
  };

  return (
    <form aria-label="다운로드 요청" noValidate onSubmit={submit} className="flex min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {work?.code || code.trim() ? <div className="flex min-w-0 items-start gap-4" data-resource-work="">
          {work?.cover ? <img src={work.cover} alt="" referrerPolicy="no-referrer" onError={event => event.currentTarget.remove()}
            className="w-card-cover shrink-0 rounded-2lg" /> : null}
          <div className="flex min-w-0 flex-col gap-2">
            <p className="break-words text-body-medium text-text-primary">{work ? [work.code, work.title].filter(Boolean).join(' · ') : "항목 정보를 가져오지 못했습니다"}</p>
            {work ? <Help>{[work.performers, work.studio, work.release_date, work.duration ? `${Math.round(work.duration / 60)} 분` : ''].filter(Boolean).join(' · ')}</Help> : null}
          </div>
        </div> : null}
        <ResourceSearch initialCode={prefill.code ?? ''} reason={prefill.searchReason} onSearch={requested => {
          if (!sameWorkCode(requested, work?.code)) { setWork(sameWorkCode(requested, prefill.code) ? prefill : null); setMagnet('') }
          setCode(requested);
        }} onWork={next => setWork(current => next ? sameWorkCode(current?.code, next.code)
          ? { ...current, ...next, origin: current?.origin || next.origin } : next
          : sameWorkCode(current?.code, prefill.code) ? current : null)} choose={(uri, selectedCode) => {
          setMagnet(uri); setCode(selectedCode); input.current?.focus();
        }} />
        <Input ref={input} label="마그넷 링크" placeholder="magnet:?xt=urn:btih:…" autoComplete="off" maxLength={4000}
          value={magnet} onChange={setMagnet} />
        <div className="flex flex-col gap-1">
          <FieldLabel>다운로드 위치</FieldLabel>
          <Select aria-label="다운로드 위치" selectedKey={provider} isDisabled={!configured.length}
            onSelectionChange={(key) => { if (key !== null) choose(String(key) as DownloadProviderKey) }}>
            {configured.map((row) => <SelectItem key={row.key} id={row.key} textValue={row.label}><SourceLabel source={row.key} label={row.label} /></SelectItem>)}
          </Select>
          {provider === '115' ? <Help>요청할 때마다 오프라인 다운로드 할당량 1회를 사용합니다. 재요청도 포함됩니다.</Help> : null}
        </div>
        {!snapshot.available ? <Note tone="neutral">클라우드 다운로드는 원장을 기록하는 기기에서만 사용할 수 있습니다.</Note> : null}
        {!configured.length ? <Note tone="neutral">다운로드 서비스가 설정되지 않았습니다.<a href={'/settings/library?section=' + encodeURIComponent('下载渠道')}>다운로드 서비스 설정</a></Note> : null}
        <Input label="대상 폴더" placeholder="/클라우드 다운로드" autoComplete="off" maxLength={300}
          value={target} onChange={setTarget} />
        {/* 带着番号进来时它和搜索框是同一个值，选中候选也会跟着换，不再单列一格。 */}
        {prefill.code ? null
          : <Input label="품번" placeholder="선택 사항" autoComplete="off" maxLength={60} value={code} onChange={value => {
            setCode(value); if (!sameWorkCode(value, work?.code)) setWork(null);
          }} />}
        {failure || action.error ? <ErrorText>{failure || action.error}</ErrorText> : null}
      </div>
      <div className="flex justify-between gap-4 p-3">
        <Button variant="secondary" onClick={close}>취소</Button>
        <Button type="submit" disabled={!magnet.trim() || !usable} {...busyProps(action.busy === 'submit')}>다운로드 요청</Button>
      </div>
    </form>
  );
}

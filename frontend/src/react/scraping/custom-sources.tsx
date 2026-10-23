import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { confirmModal, spinnerHtml } from '@peach/legacy/ui';
import { esc } from '@peach/legacy/core';
import { apiSend, errorMessage } from '../../api';
import { queryClient } from '../query';
import { CodeBlock } from '../components/code-block';
import { ErrorText, FieldLabel, Footer, Help, Section, Stack } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import { SelectField } from '../settings-panel/legacy-controls';
import { CUSTOM_SOURCES_URL as URL, CUSTOM_SOURCES_KEY as KEY, fetchCustomSources,
  type CustomSource as Source } from './custom-source-data';

const FIELDS = [['code', "품번"], ['title', "제목"], ['studio', "스튜디오"], ['series', "시리즈"],
  ['release_date', "출시일"], ['performers', "배우(텍스트 배열)"], ['tags', "태그(텍스트 배열)"]] as const;
const TYPES = [['censored', "모자이크"], ['amateur', "아마추어"], ['uncensored', "무수정"], ['fc2', 'FC2'],
  ['kmib', "한국 MIB"], ['other', "기타"], ['unsure', "확인 대기 품번"], ['unknown', "알 수 없음"]] as const;
const blank = (): Source => ({ name: '', endpoint: '', enabled: false, fields: { code: 'id', title: 'title' }, content_types: ['censored'] });

export function CustomSources({ receipt }: { receipt(message: string): void }) {
  const [editing, setEditing] = useState<Source | null>(null);
  const query = useQuery({ queryKey: KEY, queryFn: ({ signal }) => fetchCustomSources(signal) });
  const action = useAction();
  const changed = (result: { items: Source[] }) => queryClient.setQueryData(KEY, result);
  const hasContent = Boolean(query.isPending || query.error || query.data?.items.length || action.error);
  const add = <Button variant="secondary" onClick={() => setEditing(blank())}>출처 추가</Button>;
  return <Section title="사용자 지정 메타데이터 출처">
    {hasContent ? <Stack>
      {query.isPending ? <div aria-busy="true" data-skeleton="" aria-label="사용자 지정 출처 불러오기" /> : null}
      {query.error ? <ErrorText>{errorMessage(query.error)}</ErrorText> : null}
      {query.data?.items.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">{source.name} · {source.enabled ? "활성화됨" : "사용 중지됨"}</span>
        <Button variant="secondary" onClick={() => setEditing(source)}>편집</Button>
        <Button variant="secondary" {...busyProps(action.busy === source.id)} onClick={() => void action.run(source.id!,
          (signal) => apiSend<{ items: Source[] }>(URL, { ...source, enabled: !source.enabled }, 'POST', signal),
          (result) => { changed(result); receipt(source.enabled ? "출처 사용이 중지되었습니다" : "출처 사용이 설정되었습니다") })}>
          {source.enabled ? "사용 중지" : "활성화"}</Button>
        <Button variant="danger" onClick={() => confirmModal({ title: "사용자 지정 출처 삭제",
          body: `「${esc(source.name)}」을(를) 삭제하면 수집 시 이 출처를 더 이상 조회하지 않습니다.`, confirmLabel: "출처 삭제",
          onConfirm: async () => { changed(await apiSend<{ items: Source[] }>(URL, { action: 'delete', id: source.id }));
            setEditing(null); receipt("출처가 삭제되었습니다") } })}>삭제</Button>
      </div>)}
      {action.error ? <ErrorText>{action.error}</ErrorText> : null}
    </Stack> : null}
    {!editing ? hasContent ? <Footer>{add}</Footer> : <Stack><div className="flex justify-end">{add}</div></Stack> : null}
    {editing ? <SourceForm key={editing.id || 'new'} initial={editing} cancel={() => setEditing(null)}
      saved={(result) => { changed(result); setEditing(null); receipt("출처가 저장되었습니다") }} /> : null}
  </Section>;
}

function SourceForm({ initial, cancel, saved }: {
  initial: Source; cancel(): void; saved(result: { items: Source[] }): void;
}) {
  const [source, setSource] = useState(initial);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<string>('');
  const revision = useRef(0);
  const action = useAction();
  const change = (patch: Partial<Source>) => { revision.current++; setSource((current) => ({ ...current, ...patch })); setPreview('') };
  return <form aria-label="메타데이터 출처 설정" aria-busy={action.busy === 'preview'} onSubmit={(event) => {
    event.preventDefault();
    void action.run('save', (signal) => apiSend<{ items: Source[] }>(URL, source, 'POST', signal), saved);
  }}>
    <Stack>
      <Input label="소스 이름" value={source.name} maxLength={80} onChange={(name) => change({ name })} />
      <Input label="JSON API 주소" value={source.endpoint} maxLength={2048}
        placeholder="https://example.com/api/movies/{code}" onChange={(endpoint) => change({ endpoint })} />
      <div className="flex flex-col gap-2">
        <FieldLabel>출처 연결 방식</FieldLabel>
        <SelectField id="custom-source-network" label="출처 연결 방식" epoch={0} value={source.network || 'direct'}
          options={[["direct", "직접 연결"], ["peach_proxy", "Peach 프록시"]]} onPick={(network) => change({ network })} />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>API 품번 형식</FieldLabel>
        <SelectField id="custom-source-code-format" label="API 품번 형식" epoch={0} value={source.code_format || 'original'}
          options={[["original", "원본 그대로"], ["lowercase", "소문자"], ["compact", "하이픈 제거"], ["underscore", "하이픈을 밑줄로 변환"]]}
          onPick={(code_format) => change({ code_format })} />
      </div>
      <Help>공개 JSON API 주소와 응답 필드 경로(예: data.title)를 입력하세요. 품번 필드는 항목 식별을 확인하는 데 사용됩니다.</Help>
      {FIELDS.map(([field, label]) => <Input key={field} label={`${label}의 필드 경로`} value={source.fields[field] || ''}
        onChange={(path) => { const fields = { ...source.fields }; if (path) fields[field] = path; else delete fields[field]; change({ fields }) }} />)}
      <div className="flex flex-wrap gap-3" role="group" aria-label="적용할 콘텐츠 유형">
        {TYPES.map(([type, label]) => <Checkbox key={type} isSelected={source.content_types.includes(type)}
          onChange={(checked) => change({ content_types: checked ? [...source.content_types, type] : source.content_types.filter((kind) => kind !== type) })}>{label}</Checkbox>)}
      </div>
      <Checkbox isSelected={source.enabled} onChange={(enabled) => change({ enabled })}>사용 중인 소스</Checkbox>
      <Input label="테스트할 품번(Enter로 조회)" value={code} onChange={(value) => {
        revision.current++; setCode(value); setPreview('');
      }} onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        const current = revision.current;
        void action.run('preview', (signal) => apiSend<{ record: unknown }>(URL,
          { ...source, code, action: 'preview' }, 'POST', signal), (result) => {
            if (current === revision.current) setPreview(JSON.stringify(result.record, null, 2));
          }, (cause) => { if (current === revision.current) action.setError(errorMessage(cause)) });
      }} />
      {action.busy === 'preview' ? <Help role="status"><span dangerouslySetInnerHTML={{ __html: spinnerHtml("출처 조회 테스트 중") }} />출처 조회 테스트 중…</Help> : null}
      {preview ? <CodeBlock code={preview} language="json" label="메타데이터 API 응답" /> : null}
      {action.error ? <ErrorText>{action.error}</ErrorText> : null}
    </Stack>
    <Footer><Button variant="secondary" type="button" onClick={cancel}>취소</Button>
      <Button type="submit" {...busyProps(action.busy === 'save')}>출처 저장</Button></Footer>
  </form>;
}

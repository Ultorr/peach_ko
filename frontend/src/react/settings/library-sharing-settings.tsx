import { useMemo, useState } from 'react';

import { SettingsRow } from '@/components/application/settings/settings-rows';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Switch } from '@/components/base/switch/switch';

import { apiGet, apiSend } from '../../api';
import { CodeBlock } from '../components/code-block';
import { Disclosure, ErrorText, Footer, Help, Rows, Stack } from './section';
import { busyProps, useAction } from './use-action';

export interface LibrarySharingState {
  enabled: boolean; available: boolean; schema: number; fields: string[]; notice: string;
  last_attempt?: { period?: string; status?: string; reason?: string };
}
interface Preview { data: { library: unknown[]; preferences: unknown; coverage: { uncoded_items: number } }; bytes: number; token: string; schema: number }

export function LibrarySharingSettings({ initial, receipt }: {
  initial: LibrarySharingState; receipt(message: string): void;
}) {
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const previewText = useMemo(() => preview ? JSON.stringify(preview.data, null, 2) : '', [preview]);
  const action = useAction();
  const save = (enabled: boolean) => void action.run('save', (signal) =>
    apiSend<LibrarySharingState>('/api/configuration/library-sharing', {
      enabled, schema: value.schema, consent: accepted, preview_token: preview?.token,
    }, 'POST', signal), (saved) => {
    setValue(saved); setPreview(null); setAccepted(false); setReviewing(false); receipt("컬렉션 및 취향 업로드 옵션을 저장했습니다");
  });
  const downloadPreview = () => {
    const url = URL.createObjectURL(new Blob([previewText], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'peach-library-taste-preview.json';
    document.body.append(anchor);
    try { anchor.click() } finally {
      anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  return <>
    <Rows><SettingsRow label="컬렉션 및 취향 상세 정보 업로드" description={value.notice}>
      <Switch aria-label="컬렉션 및 취향 상세 정보 업로드" isSelected={value.enabled}
        onChange={(enabled) => enabled ? setReviewing(true) : save(false)}
        {...busyProps(action.busy === 'save')} />
    </SettingsRow></Rows>
    {!value.available ? <Stack divided><Help>업로드 서비스가 설정되지 않았습니다.</Help></Stack> : null}
    {value.enabled && value.last_attempt?.status === 'failed'
      ? <Stack divided><ErrorText>컬렉션 및 취향 업로드에 실패했습니다. 자동으로 재시도합니다.</ErrorText></Stack> : null}
    {preview ? <Stack divided>
      <Help>현재 미리보기에는 번호가 있는 항목 {preview.data.library.length} 개의 정보와 번호가 없는 컬렉션 항목{preview.data.coverage.uncoded_items} 개의 요약 정보가 포함되어 있으며, 크기는 약 {(preview.bytes / 1024).toFixed(1)} KiB입니다. 계정, 기기, 파일 경로, 브라우저 방문 기록 등의 개인 데이터는 포함되지 않습니다.</Help>
      <Disclosure summary="업로드 데이터 미리보기" defaultOpen>
        <CodeBlock code={previewText} language="json" label="컬렉션 및 취향 업로드 미리보기" maxCharacters={24000} />
      </Disclosure>
      {previewText.length > 24000 ? <Help>처음 24,000자만 표시됩니다. 다운로드하면 전체 내용을 볼 수 있습니다.</Help> : null}
      <Button variant="secondary" onClick={downloadPreview}>전체 미리보기 다운로드</Button>
      {!value.enabled ? <Checkbox isSelected={accepted} onChange={setAccepted}>업로드 미리보기를 확인했으며 컬렉션 및 취향 상세 정보 업로드에 동의합니다</Checkbox> : null}
    </Stack> : null}
    {action.error ? <Stack divided><ErrorText>{action.error}</ErrorText></Stack> : null}
    <Footer>
      <Button variant="secondary" onClick={() => { setReviewing(true); void action.run('preview',
        (signal) => apiGet<Preview>('/api/configuration/library-sharing/preview', signal),
        (data) => { setPreview(data); setAccepted(false) }) }}
        {...busyProps(action.busy === 'preview')}>업로드 내용 미리보기</Button>
      {!value.enabled && preview ? <Button disabled={!accepted} onClick={() => save(true)}
        {...busyProps(action.busy === 'save')}>동의하고 업로드 켜기</Button> : null}
      {reviewing && !value.enabled ? <Button variant="secondary" onClick={() => {
        setReviewing(false); setPreview(null); setAccepted(false);
      }}>취소</Button> : null}
    </Footer>
  </>;
}

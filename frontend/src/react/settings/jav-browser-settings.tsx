/* JAV 用户脚本的默认下载渠道与专用令牌。 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RiCheckboxBlankCircleFill } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { apiGet, apiSend, errorMessage } from '../../api';
import { LoadingDots } from '../components/loading-dots';
import { SourceLabel } from '../components/source-label';
import { ErrorText, ExternalLink, FieldLabel, Footer, Help, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

const URL = '/api/configuration/jav-browser';
interface State {
  enabled: boolean; provider: string; available: boolean; token?: string;
  providers: { key: string; label: string; configured: boolean; target: string }[];
}

export function JavBrowserSettings({ receipt, refreshKey }: { receipt(message: string): void; refreshKey: string }) {
  const query = useQuery({ queryKey: ['jav-browser-settings', refreshKey],
    queryFn: ({ signal }) => apiGet<State>(URL, signal), refetchOnMount: 'always' });
  if (query.error) return <ErrorText>{errorMessage(query.error)}</ErrorText>;
  if (query.isFetching) return <LoadingDots label="브라우저 추가 설정 불러오는 중" />;
  return query.data ? <BrowserForm initial={query.data} receipt={receipt} /> : null;
}

function BrowserForm({ initial, receipt }: { initial: State; receipt(message: string): void }) {
  const [state, setState] = useState(initial);
  const [provider, setProvider] = useState(initial.provider);
  const [token, setToken] = useState('');
  const action = useAction();
  const save = (kind: 'enable' | 'rotate' | 'disable') => {
    void action.run(kind, signal => apiSend<State>(URL, { action: kind, provider }, 'POST', signal), result => {
      const { token: issued = '', ...settings } = result;
      setState(settings);
      setToken(issued);
      receipt(kind === 'disable' ? "브라우저 추가 기능이 꺼졌습니다" : "전용 토큰이 생성되었습니다");
    });
  };
  const ready = state.providers.some(item => item.key === provider && item.configured && item.target);
  return <Section title="브라우저에서 JAV 추가">
    <Stack>
      <div><ExternalLink href="https://sleazyfork.org/zh-CN/scripts/600821">Peach 사용자 스크립트 설치</ExternalLink></div>
      <div className="flex flex-col gap-1"><FieldLabel>브라우저 추가의 다운로드 서비스</FieldLabel>
      <Select aria-label="브라우저 추가의 다운로드 서비스" selectedKey={provider}
        onSelectionChange={key => setProvider(String(key))} isDisabled={Boolean(action.busy)}>
        {state.providers.map(item => <SelectItem key={item.key} id={item.key} textValue={item.label}>
          <SourceLabel source={item.key} label={item.label} />
        </SelectItem>)}
      </Select></div>
      {!ready ? <Help>먼저 선택한 클라우드 드라이브의 계정과 대상 폴더를 저장하세요.</Help> : null}
      <Input label="Peach 주소" value={window.location.origin} isReadOnly autoComplete="off" />
      {token ? <>
        <Input label="브라우저 추가 전용 토큰" type="password" value={token} isReadOnly autoComplete="new-password" />
        <div><Button variant="secondary" type="button" onClick={() => {
          void action.run('copy', async () => navigator.clipboard.writeText(token), () => receipt("전용 토큰이 복사되었습니다"));
        }} {...busyProps(action.busy === 'copy')}>전용 토큰 복사</Button></div>
      </> : null}
      {action.error ? <ErrorText>{action.error}</ErrorText> : null}
    </Stack>
    <Footer status={<span role="status" className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex size-3 items-center justify-center">
        <RiCheckboxBlankCircleFill className={state.enabled ? 'size-2 text-notification-success-foreground' : 'size-2 text-text-tertiary'} />
      </span>{state.enabled ? "활성화됨" : "사용 안 함"}
    </span>}>
      {state.enabled ? <Button variant="secondary" type="button" disabled={Boolean(action.busy)}
        onClick={() => save('disable')}>브라우저 추가 기능 끄기</Button> : null}
      <Button type="button" disabled={!state.available || !ready || Boolean(action.busy)}
        onClick={() => save(state.enabled ? 'rotate' : 'enable')}
        {...busyProps(action.busy === 'enable' || action.busy === 'rotate')}>
        {state.enabled ? "다운로드 서비스 및 토큰 갱신" : "활성화 및 토큰 생성"}
      </Button>
    </Footer>
  </Section>;
}

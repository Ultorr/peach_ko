/* Cloudflare Tunnel：临时链接显示服务实际返回的随机入口，命名隧道显示配置好的公开主机名。
 *
 * 临时链接没有稳定域名和独立身份层，服务端会在 `open` 模式下拒绝启动。命名隧道多一份
 * 隧道令牌：它只往服务端去，回来的只有「存过没有」，这里任何时候都不显示令牌本身。
 * 模式选择只在源码开发环境出现，独立包收到的 `named_available` 是 false。 */
import { useEffect, useState, type FormEvent } from 'react';
import { Radio } from 'react-aria-components';

import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';

import { ApiError, apiSend, errorMessage } from '../../api';
import type { ConfigurationData, TunnelState } from '../bundle';
import { Note } from '../components/note';
import { queryClient } from '../query';
import { SEGMENT, SEGMENTED_TRACK, SegmentedRadioGroup as RadioGroup } from '../components/segmented';
import { CONFIGURATION_KEY, fetchConfiguration } from './configuration';
import { ExternalLink, ErrorText, Footer, Help, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

/** 连接握手在服务端进行，页面按固定间隔重问，直到拿到入口或失败原因。 */
const POLL_INTERVAL = 2000;

const MODES: [TunnelState['mode'], string][] = [['quick', "임시 링크"], ['named', "이름이 지정된 터널"]];

const HELP: Record<TunnelState['mode'], string> = {
  quick: "임시 미리보기용입니다. 주소는 임의로 생성되며 다시 시작하면 바뀝니다. 시작하기 전에 접근 비밀번호를 설정해야 합니다.",
  named: "Cloudflare에 연결한 고정 도메인을 사용합니다. 시작하기 전에 접근 비밀번호를 설정해야 합니다.",
};

type FieldErrors = Partial<Record<'hostname' | 'mode', string>>;

export function TunnelSettings({ revision: initialRevision, initial, receipt }: {
  revision: string;
  initial: TunnelState;
  receipt(message: string): void;
}) {
  const [state, setState] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [mode, setMode] = useState<TunnelState['mode']>(initial.mode);
  const [hostname, setHostname] = useState(initial.hostname);
  const [token, setToken] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const action = useAction();
  const active = state.state === 'starting' || state.state === 'running';
  const named = state.named_available && mode === 'named';

  useEffect(() => {
    if (state.state !== 'starting') return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void fetchConfiguration(controller.signal)
        .then((next: ConfigurationData) => {
          if (controller.signal.aborted || !next.tunnel) return;
          // 取回来的是整份配置，换进整页那一个键：屏幕上只有一份真相。
          queryClient.setQueryData(CONFIGURATION_KEY, next);
          setState(next.tunnel);
          setRevision(next.revision);
        })
        .catch(() => undefined);
    }, POLL_INTERVAL);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [state.state]);

  /** 开关和保存走同一个端点：形态与开关状态一次提交，服务端据此构造启动计划。 */
  const send = (key: 'save' | 'toggle', enabled: boolean, done: (next: TunnelState) => void) => {
    setFields({});
    void action.run(key, (signal) => apiSend<TunnelState & { revision: string }>(
      '/api/configuration/tunnel',
      { revision, enabled, mode, hostname, token }, 'POST', signal,
    ), (next) => {
      setState(next);
      setRevision(next.revision);
      setMode(next.mode);
      setHostname(next.hostname);
      // 令牌交上去之后草稿就清掉：页面上不留一份明文，回来的也只有「存过没有」。
      setToken('');
      done(next);
    }, (cause) => {
      const payload = cause instanceof ApiError
        ? cause.body as { errors?: FieldErrors; detail?: { errors?: FieldErrors } } : null;
      const errors = payload?.errors || payload?.detail?.errors;
      if (errors) setFields(errors); else action.setError(errorMessage(cause));
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send('save', active, () => receipt("설정이 저장되었습니다"));
  };

  const toggle = () => send('toggle', !active, (next) => receipt(
    next.enabled ? "외부 접속을 시작했습니다" : "외부 접속을 중지했습니다",
  ));

  return (
    <Section title="Cloudflare 외부 접속" onSubmit={submit}>
      <Stack>
        {state.named_available
          ? <RadioGroup aria-label="외부 접속 방식(하나 선택)" value={mode} isDisabled={active}
              onChange={(next) => setMode(next as TunnelState['mode'])} className={SEGMENTED_TRACK}>
              {MODES.map(([value, label]) => (
                <Radio key={value} value={value} className={SEGMENT}>{label}</Radio>
              ))}
            </RadioGroup>
          : null}
        <Help>{HELP[named ? 'named' : 'quick']}</Help>
        {named ? <>
          <Input id="tunnel-hostname" label="공개 호스트 이름" autoComplete="off" maxLength={253}
            value={hostname} onChange={setHostname} isDisabled={active} validationBehavior="aria"
            isInvalid={Boolean(fields.hostname)}
            hint={fields.hostname || "Cloudflare Zero Trust에서 이 컴퓨터를 가리키는 호스트 이름입니다."} />
          <Input id="tunnel-token" type="password" label="터널 토큰" autoComplete="off" maxLength={2048}
            value={token} onChange={setToken} isDisabled={active} validationBehavior="aria"
            hint={state.token_set
              ? "저장됨. 비워 두면 변경하지 않습니다."
              : "Cloudflare Zero Trust의 터널 상세 페이지에서 복사하세요."} />
        </> : null}
        {!state.available
          ? <Note tone="warning" title="cloudflared를 찾을 수 없습니다">공식 cloudflared를 설치하거나 설정 파일의 tunnel.binary 및 PEACH_CLOUDFLARED로 경로를 지정하세요.</Note>
          : null}
        {state.state === 'running' && state.url
          ? <Note tone="info" title="외부 접속 주소"><ExternalLink href={state.url}>{state.url}</ExternalLink></Note>
          : null}
        {state.state === 'starting' ? <Note tone="info" title="연결 중">cloudflared가 Cloudflare 엣지에 연결되기를 기다리고 있습니다.</Note> : null}
        {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        {action.error ? <ErrorText>{action.error}</ErrorText> : null}
      </Stack>
      <Footer status={state.enabled ? "Peach를 다시 시작하면 자동으로 복구됩니다." : undefined}>
        <Button variant={state.named_available ? 'secondary' : 'primary'} onClick={toggle} {...busyProps(action.busy === 'toggle')}>
          {active ? "외부 접속 중지" : "외부 접속 시작"}
        </Button>
        {state.named_available
          ? <Button type="submit" {...busyProps(action.busy === 'save')}>설정 저장</Button>
          : null}
      </Footer>
    </Section>
  );
}

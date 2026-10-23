/* 「推送发现」：新文件落地就进账本，不必等下一轮全量扫描。
 *
 * 两条通道各一个开关。本地那条订阅本机文件夹的文件系统事件；网盘那条等 CloudDrive2 往
 * Peach 推一条通知，所以给出一段能整个贴进它「配置内容」的 TOML，外加一张「云端路径
 * 前缀 → 媒体根」的对应表。定期全量扫描不受这一页影响，它仍是漏发时的兜底。
 *
 * 地址、密钥不单独列成读数：它们只在那段配置里有用，抄两处只会抄漏一处。整段由服务端
 * 拼（`peach.push_discovery.clouddrive_config`）。
 *
 * 前缀怎么算合法、根是不是已声明过，同样由服务端判；这一页只把那句原因显示出来。
 *
 * 整块只有一种行：读数写在它所属那个开关的说明里，配置通过共用代码块展示与复制，
 * 前缀表排在最后。读数与配置跟着各自的开关收起：网盘通道关着时那段配置指向一件不会
 * 发生的事；本机监视在总开关关着时读作「没有运行」，分不出是没开还是坏了。 */
import { useState, type FormEvent } from 'react';
import { RiDeleteBinLine } from '@remixicon/react';

import { SettingsRow } from '@/components/application/settings/settings-rows';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';

import { apiSend, errorMessage } from '../../api';
import type { PushDiscoveryPrefix, PushDiscoveryState } from '../bundle';
import { CodeBlock } from '../components/code-block';
import { Disclosure, ErrorText, FieldLabel, Footer, Help, Rows, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

const SAVE_URL = '/api/configuration/push-discovery';
const SECRET_URL = '/api/configuration/push-discovery/secret';

export function PushDiscoveryForm({ initial, receipt }: {
  initial: PushDiscoveryState;
  receipt(message: string): void;
}) {
  const [state, setState] = useState(initial);
  const [rows, setRows] = useState<PushDiscoveryPrefix[]>(initial.prefixes);
  const [failure, setFailure] = useState('');
  const action = useAction();
  const roots = state.media_roots;
  /* 读数说的是服务端此刻在跑什么，所以按已保存的开关收放：拨一下开关它们就跟着出现的话，
     写的还是上一次的状态，「本机文件夹监视 · 没有运行」会被读成「打开了也没用」。
     要填的东西（前缀表）反过来跟着拨到哪儿走，否则得先保存一次才能填。 */
  const [live, setLive] = useState(initial);

  const settle = (next: PushDiscoveryState, message: string) => {
    setState(next);
    setLive(next);
    setRows(next.prefixes);
    setFailure('');
    receipt(message);
  };

  const edit = (index: number, patch: Partial<PushDiscoveryPrefix>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      enabled: state.enabled, watch_local: state.watch_local, cloud: state.cloud, prefixes: rows,
    };
    void action.run('save', (signal) => apiSend<PushDiscoveryState>(SAVE_URL, body, 'POST', signal),
      (next) => settle(next, "설정이 저장되었습니다"), (cause) => setFailure(errorMessage(cause)));
  };

  const rotate = () => {
    void action.run('secret', (signal) => apiSend<PushDiscoveryState>(SECRET_URL, {}, 'POST', signal),
      (next) => settle(next, "공유 키를 변경했습니다"), (cause) => setFailure(errorMessage(cause)));
  };

  const ingested = `등록 완료: ${live.queue.ingested} 개 파일`
    + (live.queue.pending ? `, 대기 중: ${live.queue.pending} 개` : '');
  const watching = live.local_running
    ? `모니터링 중: ${live.local_roots.join('、')}` : live.local_message || "실행 중이 아님";

  return (
    <Section title="푸시 알림으로 파일 감지" onSubmit={submit}>
      <Rows>
        <SettingsRow label="새 파일이 생기면 즉시 등록" description={live.enabled ? ingested : undefined}>
          <Switch aria-label="새 파일이 생기면 즉시 등록" isSelected={state.enabled} isDisabled={!state.available}
            onChange={(enabled) => setState({ ...state, enabled })} />
        </SettingsRow>
        <SettingsRow label="이 기기의 폴더 모니터링" description={live.enabled && live.watch_local ? watching : undefined}>
          <Switch aria-label="이 기기의 폴더 모니터링" isSelected={state.watch_local}
            isDisabled={!state.available || !state.enabled}
            onChange={(watchLocal) => setState({ ...state, watch_local: watchLocal })} />
        </SettingsRow>
        <SettingsRow label="CloudDrive2 알림 받기">
          <Switch aria-label="CloudDrive2 알림 받기" isSelected={state.cloud}
            isDisabled={!state.available || !state.enabled}
            onChange={(cloud) => setState({ ...state, cloud })} />
        </SettingsRow>
        {live.enabled && live.cloud ? (
          <SettingsRow label="Webhook 설정" description={live.config_toml
            ? "CloudDrive2의 ‘설정 → Webhooks’에 붙여 넣으세요. 유료 멤버십이 필요하며 키를 변경하면 다시 붙여 넣어야 합니다."
            : live.origin
              ? "공유 키가 아직 없습니다. 설정을 저장하면 생성됩니다."
              : "먼저 CloudDrive2에서 접근할 수 있는 HTTPS 주소가 있어야 생성할 수 있습니다."}>
          </SettingsRow>
        ) : null}
      </Rows>
      {live.enabled && live.cloud && live.config_toml ? (
        <Stack divided>
          <div className="flex flex-col gap-3">
            {/* 收起来是因为抄它的人不用读它：三十行里只有地址和密钥两处跟这台机器有关，
                两处都已经填好了。展开是留给要核对推到哪儿的那一次。 */}
            <Disclosure summary="설정 보기">
              <CodeBlock code={live.config_toml} language="toml" label="CloudDrive2 설정" bounded={false} copyLabel="설정 복사"
                onCopy={() => receipt("CloudDrive2 설정을 복사했습니다")} />
              <Help>Windows 데스크톱 버전에서 붙여 넣은 후 ‘유효하지 않음’이 표시되면 이 내용을 .toml 파일로 저장하여
                %LOCALAPPDATA%\CloudDrive.WinUI\webhooks\ 폴더에 넣으세요.</Help>
            </Disclosure>
          </div>
        </Stack>
      ) : null}
      {state.enabled && state.cloud ? (
        <Stack divided>
          <div className="flex flex-col gap-3">
            <FieldLabel>클라우드 경로 접두사</FieldLabel>
            <div role="group" aria-label="클라우드 경로 접두사" className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Input className="min-w-0 flex-1" aria-label={`클라우드 경로 접두사 ${index + 1}`}
                    placeholder="/115" autoComplete="off" maxLength={200} value={row.prefix}
                    onChange={(prefix) => edit(index, { prefix })} />
                  <Select aria-label={`접두사 ${index + 1} 에 해당하는 미디어 루트`} selectedKey={row.root}
                    onSelectionChange={(key) => { if (key !== null) edit(index, { root: String(key) }); }}>
                    {roots.map((root) => <SelectItem key={root} id={root}>{root}</SelectItem>)}
                  </Select>
                  <Button variant="danger" iconOnly leadingIcon={RiDeleteBinLine} aria-label="이 항목 제거"
                    onClick={() => setRows((list) => list.filter((_row, i) => i !== index))} />
                </div>
              ))}
            </div>
            <div>
              <Button variant="secondary" size="small"
                onClick={() => setRows((list) => [...list, { prefix: '', root: roots[0] ?? '' }])}>
                접두사 추가
              </Button>
            </div>
          </div>
        </Stack>
      ) : null}
      {/* 保存失败的原因归这一块，不跟着前缀表一起收起：域名或前缀写坏时那张表可能正好
          没在屏上，而失败的正是刚按下的那颗「保存配置」。 */}
      {failure || action.error
        ? <Stack divided><ErrorText>{failure || action.error}</ErrorText></Stack> : null}
      <Footer>
        {live.enabled && live.cloud && live.config_toml ? (
          <Button variant="secondary" onClick={rotate} disabled={!state.available}
            {...busyProps(action.busy === 'secret')}>키 변경</Button>
        ) : null}
        <Button type="submit" disabled={!state.available} {...busyProps(action.busy === 'save')}>
          설정 저장
        </Button>
      </Footer>
    </Section>
  );
}

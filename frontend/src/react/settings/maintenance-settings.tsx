/* 「应用与维护」中的运行信息、安装教程与卸载。 */
import { useState, type FormEvent } from 'react';
import { confirmModal } from '@peach/legacy/ui';

import { SettingsCard, SettingsRow } from '@/components/application/settings/settings-rows';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';

import { apiSend } from '../../api';
import type {
  AutomaticUpdateState, ConfigurationFact, ConfigurationGroupProps, ConfigurationProps, UninstallState,
} from '../bundle';
import { PathLine } from '../components/path-line';
import { groupRoot } from './configuration-panel';
import { Disclosure, ErrorText, ExternalLink, Fact, FactList, Footer, Help, Rows, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

const INTERVALS = [['6', "6시간마다"], ['24', "매일"], ['168', "매주"]] as const;

export function MaintenanceSettings(
  { data, receipt, reopenTutorial, panel }: ConfigurationGroupProps & Pick<ConfigurationProps, 'reopenTutorial'>,
) {
  return (
    <div {...groupRoot(panel)}>
      <Facts facts={data.facts} />
      <TutorialSettings receipt={receipt} reopenTutorial={reopenTutorial} />
      {data.uninstall ? <UninstallSettings uninstall={data.uninstall} receipt={receipt} /> : null}
    </div>
  );
}

/** 安装教程的重开入口。教程卡本身还画在遗留层，这里只按一下让它回来。 */
export function TutorialSettings({ receipt, reopenTutorial }: ConfigurationProps) {
  const action = useAction();
  const reopen = () => void action.run('reopen', () => reopenTutorial(),
    () => receipt("설치 안내를 다시 열었습니다"));
  return (
    <section aria-label="설치 안내" className="w-full"><SettingsCard>
      <Rows><SettingsRow label="설치 안내">
        <Button variant="secondary" onClick={reopen} {...busyProps(action.busy === 'reopen')}>설치 안내 다시 열기</Button>
      </SettingsRow></Rows>
      {action.error ? <Stack><ErrorText>{action.error}</ErrorText></Stack> : null}
    </SettingsCard></section>
  );
}

export function AutomaticUpdates({ initial, receipt }: { initial: AutomaticUpdateState; receipt(message: string): void }) {
  const [mode, setMode] = useState(initial.mode);
  const [hours, setHours] = useState(initial.interval_hours);
  const action = useAction(initial.error);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initial.available) return;
    void action.run('save', (signal) => apiSend<AutomaticUpdateState>('/api/configuration/automatic-updates',
      { mode, interval_hours: hours }, 'POST', signal), () => receipt("설정이 저장되었습니다"));
  };

  const help = !initial.available
    ? "자동 업데이트에는 트레이에서 관리하는 서비스가 필요합니다."
    : initial.download_available
      ? "다운로드가 완료되면 여기에서 재시작 및 설치를 확인하세요."
      : undefined;
  return (
    <Section title="자동 업데이트" onSubmit={submit}>
      <Rows>
        <SettingsRow label="새 버전 자동 확인">
          <Switch aria-label="새 버전 자동 확인" isSelected={mode !== 'off'} isDisabled={!initial.available}
            onChange={(on) => setMode(on ? 'check' : 'off')} />
        </SettingsRow>
        <SettingsRow label="업데이트 자동 다운로드">
          <Switch aria-label="업데이트 자동 다운로드" isSelected={mode === 'download'}
            isDisabled={!initial.available || !initial.download_available || mode === 'off'}
            onChange={(on) => setMode(on ? 'download' : 'check')} />
        </SettingsRow>
        <SettingsRow label="확인 주기" description={help}>
          <Select aria-label="확인 주기" selectedKey={String(hours)} isDisabled={!initial.available}
            onSelectionChange={(key) => { if (key !== null) setHours(Number(key)); }}>
            {INTERVALS.map(([key, name]) => <SelectItem key={key} id={key}>{name}</SelectItem>)}
          </Select>
        </SettingsRow>
      </Rows>
      {action.error ? <Stack divided><ErrorText>{action.error}</ErrorText></Stack> : null}
      <Footer>
        <Button type="submit" disabled={!initial.available} {...busyProps(action.busy === 'save')}>설정 저장</Button>
      </Footer>
    </Section>
  );
}

function Facts({ facts }: { facts: ConfigurationFact[] }) {
  return (
    <Section title="실행 정보">
      <FactList>
        <Fact term="한국어판 소스">
          <ExternalLink href="https://github.com/Ultorr/peach_ko/tree/korean-0.46.1">소스 코드 받기</ExternalLink>
        </Fact>
        <Fact term="라이선스">
          <ExternalLink href="https://github.com/Ultorr/peach_ko/blob/korean-0.46.1/LOCALIZATION_LICENSE.md">AGPL-3.0-or-later · 비공식 한국어판</ExternalLink>
        </Fact>
        {facts.map((fact) => (
          <Fact key={fact.term} term={fact.term}>
            {fact.value}
            {fact.download_url ? <ExternalLink href={fact.download_url}>{fact.download_label}</ExternalLink> : null}
          </Fact>
        ))}
      </FactList>
    </Section>
  );
}

export function UninstallSettings(
  { uninstall, receipt }: { uninstall: UninstallState; receipt(message: string): void },
) {
  const [removeData, setRemoveData] = useState(false);
  const [accepted, setAccepted] = useState('');
  const remove = () => void confirmModal({
    title: "Peach 제거",
    danger: true,
    body: removeData
      ? "Peach를 종료하고 프로그램, 시작 프로그램 등록, 바탕 화면 아이콘, 설정, 로컬 데이터베이스, 시청 기록, 인증 정보 및 캐시를 삭제합니다. 원본 미디어 파일은 유지됩니다."
      : "Peach를 종료하고 프로그램, 시작 프로그램 등록 및 바탕 화면 아이콘을 삭제합니다. 설정, 로컬 데이터베이스, 시청 기록 및 캐시는 유지됩니다.",
    confirmLabel: "Peach 제거",
    onConfirm: async () => {
      const result = await apiSend<{ message: string }>('/api/configuration/uninstall', { delete_data: removeData, confirmation: '卸载 Peach' });
      setAccepted(result.message);
    },
  });
  // 底栏左边一句说这颗按钮此刻意味着什么：拦住卸载的理由（源码安装、更新还在跑）和按下去
  // 之后的回执都在答「这颗现在能不能按」，摆在正文末尾就得先读完整段说明才找得到。
  const status = accepted || uninstall.message;
  const paths = [...new Set([uninstall.data_root, ...uninstall.directories])];
  return (
    <Section id="uninstallPeach" title="Peach 제거">
      {uninstall.available ? <Stack><Help>Peach 프로그램을 제거합니다. 원본 미디어 파일은 유지됩니다.</Help></Stack> : null}
      <Rows>
        <SettingsRow label="완전히 제거" description="설정, 로컬 데이터베이스, 시청 기록, 인증 정보 및 캐시도 삭제">
          <Switch aria-label="완전히 제거" isSelected={removeData} isDisabled={!uninstall.full_available || Boolean(accepted)} onChange={setRemoveData} />
        </SettingsRow>
      </Rows>
      <Stack divided>
        <Disclosure summary="데이터 폴더">
          {paths.map((path) => (
            <PathLine key={path} path={path} className="text-body-2-regular text-text-secondary" onRevealed={receipt} />
          ))}
        </Disclosure>
      </Stack>
      <Footer status={status ? <p role={accepted ? 'status' : undefined}>{status}</p> : null}>
        <Button variant="danger" disabled={!uninstall.available || Boolean(accepted)} onClick={remove}>Peach 제거</Button>
      </Footer>
    </Section>
  );
}

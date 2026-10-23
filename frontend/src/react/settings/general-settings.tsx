/* 「应用与维护」中的开机自启、桌面快捷方式与版本更新。 */
import { useState, type FormEvent } from 'react';

import { SettingsRow } from '@/components/application/settings/settings-rows';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';

import { apiSend } from '../../api';
import type { ConfigurationGroupProps, StartupState } from '../bundle';
import { groupRoot } from './configuration-panel';
import { AutomaticUpdates } from './maintenance-settings';
import { ReleaseUpdates } from './release-updates';
import { RemoteReportingSettings } from './remote-reporting-settings';
import { LibrarySharingSettings } from './library-sharing-settings';
import { ErrorText, Footer, Help, Rows, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

export function GeneralSettings({ data, receipt, panel }: ConfigurationGroupProps) {
  return (
    <div {...groupRoot(panel)}>
      {data.remote_reporting || data.library_sharing ? <Section title="데이터 업로드">
        {data.remote_reporting ? <RemoteReportingSettings initial={data.remote_reporting} receipt={receipt} /> : null}
        {data.library_sharing ? <div className="border-t border-separator-border">
          <LibrarySharingSettings initial={data.library_sharing} receipt={receipt} />
        </div> : null}
      </Section> : null}
      {data.startup ? <StartupSettings startup={data.startup} receipt={receipt} /> : null}
      {data.automatic_updates ? <AutomaticUpdates initial={data.automatic_updates} receipt={receipt} /> : null}
      {data.updates ? <ReleaseUpdates initial={data.updates} initialJob={data.update_job} /> : null}
    </div>
  );
}

export function StartupSettings({ startup, receipt }: { startup: StartupState; receipt(message: string): void }) {
  const [enabled, setEnabled] = useState(startup.enabled);
  const [silent, setSilent] = useState(startup.silent);
  const [desktop, setDesktop] = useState(startup.desktop);
  const action = useAction();
  // 桌面快捷方式只有 Windows 有，桌面上已经摆着另一份安装的图标时也不给动；两种情况后端
  // 都在 desktop_message 里说了原因，所以按它有没有内容判禁用，不在前端判平台。
  const desktopReady = startup.available && !startup.desktop_message;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!startup.available) return;
    void action.run('save', (signal) => apiSend('/api/configuration/startup', { enabled, silent, desktop }, 'POST', signal),
      () => receipt("설정이 저장되었습니다"));
  };

  return (
    <Section title="시스템 시작 시 자동 실행" onSubmit={submit}>
      <Rows>
        <SettingsRow label="시스템 시작 후 Peach 실행">
          <Switch aria-label="시스템 시작 후 Peach 실행" isSelected={enabled} isDisabled={!startup.available} onChange={setEnabled} />
        </SettingsRow>
        <SettingsRow label="웹페이지를 열지 않고 트레이만 실행">
          <Switch aria-label="웹페이지를 열지 않고 트레이만 실행" isSelected={silent} isDisabled={!startup.available || !enabled} onChange={setSilent} />
        </SettingsRow>
        <SettingsRow label="바탕 화면에 바로가기 만들기" description={startup.desktop_message || undefined}>
          <Switch aria-label="바탕 화면에 바로가기 만들기" isSelected={desktop} isDisabled={!desktopReady} onChange={setDesktop} />
        </SettingsRow>
      </Rows>
      {startup.message || action.error ? (
        <Stack divided>
          {startup.message ? <Help>{startup.message}</Help> : null}
          {action.error ? <ErrorText>{action.error}</ErrorText> : null}
        </Stack>
      ) : null}
      <Footer>
        <Button type="submit" disabled={!startup.available} {...busyProps(action.busy === 'save')}>설정 저장</Button>
      </Footer>
    </Section>
  );
}

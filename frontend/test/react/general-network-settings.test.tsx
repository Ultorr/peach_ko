import { expect, it, vi } from 'vitest';

import { StartupSettings } from '../../src/react/settings/general-settings';
import { PeachProxy } from '../../src/react/settings/network-settings';
import { buttonNamed, choose, click, fetchMock, mount, sentBody, settle, submit, switches, type } from './render';

const startup = { available: true, enabled: false, silent: true, message: '', desktop: false, desktop_message: '' };

it('开机自启：静默启动跟着开机自启解锁，保存发出三颗开关的实际值', async () => {
  const fetcher = fetchMock(200, {});
  vi.stubGlobal('fetch', fetcher);
  const receipt = vi.fn();
  const host = await mount(<StartupSettings startup={startup} receipt={receipt} />);
  expect(switches(host).map((input) => input.getAttribute('aria-label')))
    .toEqual(['시스템 시작 후 Peach 실행', '웹페이지를 열지 않고 트레이만 실행', '바탕 화면에 바로가기 만들기']);
  expect(switches(host).map((input) => input.disabled)).toEqual([false, true, false]);
  expect(buttonNamed('설정 저장', host)).not.toBeNull();
  await click(switches(host)[0]);
  expect(switches(host)[1]!.disabled).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  await submit(host.querySelector('form'));
  await settle();
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/configuration/startup');
  expect(sentBody(fetcher)).toEqual({ enabled: true, silent: true, desktop: false });
  expect(receipt).toHaveBeenCalledWith('설정이 저장되었습니다');
});

it('桌面快捷方式被别的安装占着时只锁那一颗，并说出原因', async () => {
  // 桌面上摆着另一份 Peach 的图标不该连开机自启都不让改，那一格自己还是好的。
  const host = await mount(<StartupSettings
    startup={{ ...startup, enabled: true, desktop_message: '桌面快捷方式属于另一份 Peach 安装' }} receipt={vi.fn()} />);
  expect(switches(host).map((input) => input.disabled)).toEqual([false, false, true]);
  expect(buttonNamed('설정 저장', host)?.disabled).toBe(false);
  expect(host.textContent).toContain('桌面快捷方式属于另一份 Peach 安装');
});

it('Peach 代理：选自定义才出地址栏，保存后清空地址并记住已保存', async () => {
  const fetcher = fetchMock(200, { mode: 'proxy', proxy_saved: true, needs_selection: false });
  vi.stubGlobal('fetch', fetcher);
  const receipt = vi.fn();
  const host = await mount(<PeachProxy initial={{ mode: 'direct', proxy_saved: false, needs_selection: true }} receipt={receipt} />);
  expect(host.querySelector('[role="note"]')?.textContent).toContain('기존 소스의 프록시 주소가 서로 다릅니다. 공통 연결 방식을 선택하세요.');
  expect(host.querySelector('#peachProxyAddress')).toBeNull();
  await choose(host.querySelector('[aria-haspopup="listbox"]'), '사용자 지정');
  const address = host.querySelector<HTMLInputElement>('#peachProxyAddress');
  expect(address?.placeholder).toBe('http://127.0.0.1:7890');
  await type(address, 'http://127.0.0.1:7890');
  await submit(host.querySelector('form'));
  await settle();
  expect(sentBody(fetcher)).toEqual({ mode: 'proxy', proxy: 'http://127.0.0.1:7890' });
  expect(receipt).toHaveBeenCalledWith('설정이 저장되었습니다');
  const saved = host.querySelector<HTMLInputElement>('#peachProxyAddress');
  expect(saved?.value).toBe('');
  expect(saved?.placeholder).toBe('저장됨. 비워 두면 유지됩니다');
  expect(host.querySelector('[role="note"]')).toBeNull();
});

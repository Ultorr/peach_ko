import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PICK_FOLDER_URL } from '../../src/configuration-endpoints';
import { SetupPage } from '../../src/react/pages/setup/setup-page';
import { SETUP_QUESTIONS_URL, SETUP_URL, type SetupDone, type SetupQuestions } from '../../src/react/pages/setup/setup-api';
import { RESTART_REDIRECT_MS } from '../../src/react/restart-redirect';
import { MEDIA_SOURCE_OPTIONS } from '../../src/core/media-sources';
import { buttonNamed, choose, click, mount, settle, switches, type } from './render';

const questions = (over: Partial<SetupQuestions> = {}): SetupQuestions => ({
  windows: true,
  standalone: false,
  questions: [
    { key: 'data_root', label: '数据目录', help: ['Peach 数据库、缓存和设置文件都放在这里。'], default: 'C:\\peach-data',
      required: true, advanced: true, input: 'text', prefix: '', suffix: '' },
    { key: 'media_dir', label: '媒体库', help: ['Peach 从媒体库读取视频和图片。'], default: 'D:\\Videos',
      required: true, advanced: false, input: 'folders', prefix: '', suffix: '' },
    { key: 'host', label: '谁可以访问', help: [], default: '2', required: false, advanced: true, input: 'choice',
      prefix: '', suffix: '', options: [{ value: '2', label: '同一局域网的设备' }, { value: '1', label: '只有这台电脑' }] },
    { key: 'port', label: '端口', help: ['浏览器地址里冒号后面的数字，一般不用改。'], default: '8900',
      required: true, advanced: true, input: 'number', prefix: 'localhost:', suffix: '' },
    { key: 'mdns_name', label: '局域网访问地址', help: [], default: 'peach', required: true, advanced: true,
      input: 'text', prefix: 'https://', suffix: '.local', visible_when: { host: '2' } },
  ],
  media_sources: MEDIA_SOURCE_OPTIONS.map(([value, label]) => ({ value, label })),
  media_source_default: 'local',
  media_root: null,
  cloud: { help: '先在 CloudDrive 登录网盘并完成挂载。', link: { url: 'https://www.clouddrive2.com/help.html', label: '挂载帮助' },
    dependencies: [{ name: 'WinFsp', message: '未检测到 WinFsp。', download_url: 'https://winfsp.dev/rel/',
      download_label: '下载 WinFsp' }] },
  access_enabled: true,
  scan_now: true,
  history_guide: false,
  ...over,
});

const done = (over: Partial<SetupDone> = {}): SetupDone => ({
  url: 'http://127.0.0.1:8900/?onboarding=1', scan_requested: true, history_guide: false, standalone: false,
  redirect: null, facts: [{ term: '版本', value: '0.9.0' }, { term: '数据目录', value: 'C:\\peach-data' }], ...over,
});

type Reply = { status: number; body: unknown };
/** 按地址回话的假 fetch：同一地址可以排几次回话，最后一次一直重复。 */
function server(routes: Record<string, Reply | Reply[]>) {
  const queues = new Map(Object.entries(routes).map(([url, reply]) => [url, Array.isArray(reply) ? [...reply] : [reply]]));
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    const queue = queues.get(url);
    if (!queue?.length) throw new Error(`没有为 ${url} 准备回话`);
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal('fetch', fetcher);
  const sent = (url: string, index = 0) =>
    JSON.parse(String(fetcher.mock.calls.filter(([called]) => called === url)[index]?.[1]?.body));
  return { fetcher, sent };
}

async function open(over: Partial<SetupQuestions> = {}, routes: Record<string, Reply | Reply[]> = {}) {
  const api = server({ [SETUP_QUESTIONS_URL]: { status: 200, body: questions(over) }, ...routes });
  const host = await mount(<SetupPage />);
  await settle();
  return { host, ...api };
}

const rows = (root: ParentNode) => [...root.querySelectorAll('[data-folder-row]')];
const paths = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input[aria-label^="媒体库 "]')];
const field = (root: ParentNode, key: string) => root.querySelector<HTMLInputElement>(`#f-${key}`);
const radio = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('label')].find((node) => node.textContent?.trim() === label);
const advanced = (root: ParentNode) => [...root.querySelectorAll('summary')].find((node) => node.textContent === '고급 설정');
const submitForm = async (root: ParentNode) => { await click(buttonNamed('설정 완료', root)); await settle(); };
const alertsWith = (root: ParentNode, message: string) =>
  [...root.querySelectorAll('[role="alert"]')].filter((node) => node.textContent?.includes(message));
const occurrences = (root: HTMLElement, message: string) => (root.textContent ?? '').split(message).length - 1;

it('首启版本统计与错误诊断默认勾选，取消后共同关闭', async () => {
  const reporting = { usage: true, errors: true, available: false,
    fields: { usage: '版本与系统', errors: '异常链与错误码' }, notice: '不发送媒体信息' };
  const { host, sent } = await open({ remote_reporting: reporting, access_enabled: false },
    { [SETUP_URL]: { status: 200, body: done() } });
  const reportingSwitches = host.querySelectorAll<HTMLInputElement>('input[aria-label="버전 통계 및 오류 진단 보내기(권장)"]');
  expect(reportingSwitches).toHaveLength(1);
  expect(reportingSwitches[0]!.checked).toBe(true);
  await click(reportingSwitches[0]!);
  await submitForm(host);
  expect(sent(SETUP_URL).remote_reporting).toEqual({ usage: false, errors: false });
});

/** 这句错误在页面上只有一份，落在一个 `role="alert"` 里，并由框的 `aria-describedby` 指到。 */
function expectAnnounced(root: HTMLElement, input: Element | null | undefined, message: string) {
  const alerts = alertsWith(root, message);
  expect(alerts).toHaveLength(1);
  expect(occurrences(root, message)).toBe(1);
  const described = (input?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  expect(described.some((id) => document.getElementById(id)?.contains(alerts[0]!))).toBe(true);
  return alerts[0]!;
}

it('题目、默认值与题面来自读题接口：媒体库一行在外面，其余折进高级设置', async () => {
  const { host } = await open();
  expect(host.querySelector('h1')?.textContent).toBe('Peach에 오신 것을 환영합니다');
  expect(paths(host).map((input) => input.value)).toEqual(['D:\\Videos']);
  expect(advanced(host)?.getAttribute('aria-expanded')).toBe('false');
  expect(field(host, 'port')?.value).toBe('8900');
  expect(host.textContent).toContain('localhost:');
  expect(host.textContent).toContain('설정 완료 후 스캔 및 정보 보완:D:\\Videos');
  // 「谁可以访问」是两段式单选，局域网在左边并且默认选中。
  const group = host.querySelector('[role="radiogroup"]')!;
  expect([...group.querySelectorAll('input[type="radio"]')].map((input) => [
    (input as HTMLInputElement).value, (input as HTMLInputElement).checked])).toEqual([['2', true], ['1', false]]);
});

it('选「只有这台电脑」时局域网地址整项消失，也不随提交发出去', async () => {
  const { host, sent } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
  expect(field(host, 'mdns_name')).not.toBeNull();
  await click(radio(host, '只有这台电脑'));
  expect(field(host, 'mdns_name')).toBeNull();
  await submitForm(host);
  const body = sent(SETUP_URL);
  expect(body.host).toBe('1');
  expect('mdns_name' in body).toBe(false);
  expect(body.port).toBe('8900');
});

describe('访问密码', () => {
  it('开关初始按读题接口；关掉后两框收起，提交不带密码', async () => {
    const { host, sent } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
    expect(host.querySelector('#access-password')).not.toBeNull();
    await type(host.querySelector<HTMLInputElement>('#access-password'), 'secret-password');
    await click(switches(host)[0]);
    expect(host.querySelector('#access-password')).toBeNull();
    await submitForm(host);
    const body = sent(SETUP_URL);
    expect(body.access_enabled).toBe(false);
    expect('access_password' in body || 'access_confirm' in body).toBe(false);
  });

  it('只在本机访问时开关默认关着，打开后提交两次输入', async () => {
    const { host, sent } = await open({ access_enabled: false }, { [SETUP_URL]: { status: 200, body: done() } });
    expect(host.querySelector('#access-password')).toBeNull();
    await click(switches(host)[0]);
    await type(host.querySelector<HTMLInputElement>('#access-password'), 'correct-password');
    await type(host.querySelector<HTMLInputElement>('#access-confirm'), 'correct-password');
    await submitForm(host);
    expect(sent(SETUP_URL)).toMatchObject({
      access_enabled: true, access_password: 'correct-password', access_confirm: 'correct-password' });
  });
});

describe('媒体库', () => {
  it('首次设置网盘时必须明确选择读取策略', async () => {
    const { host, sent } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
    await choose(rows(host)[0]!.querySelector('[aria-haspopup="listbox"]'), 'OneDrive');
    const policy = rows(host)[0]!.querySelector('[data-media-read-policy] [aria-haspopup="listbox"]');
    expect(policy?.textContent).toContain('읽기 정책 선택');
    await submitForm(host);
    expect(host.textContent).toContain('미디어 읽기 정책을 선택하세요');
    await choose(policy, '일반 읽기');
    await submitForm(host);
    expect(sent(SETUP_URL).media_dir).toEqual([
      { path: 'D:\\Videos', location: 'onedrive', root: '', cost: 'free' },
    ]);
  });

  it('加一行、删一行，扫描说明跟着行数走，提交按行带上来源', async () => {
    const { host, sent } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
    await click(buttonNamed('미디어 라이브러리 추가', host));
    expect(rows(host)).toHaveLength(2);
    expect(document.activeElement).toBe(paths(host)[1]);
    await type(paths(host)[1], 'E:\\More');
    expect(host.textContent).toContain('설정 완료 후 2 개 폴더 스캔 및 정보 보완');
    await click(rows(host)[0]!.querySelector('button[aria-label="이 폴더 제거"]'));
    expect(paths(host).map((input) => input.value)).toEqual(['E:\\More']);
    expect(rows(host)[0]!.querySelector('button[aria-label="이 폴더 제거"]')).toBeNull();
    await submitForm(host);
    expect(sent(SETUP_URL).media_dir).toEqual([{ path: 'E:\\More', location: 'local', root: '', cost: 'free' }]);
  });

  it('选择文件夹让这台电脑弹对话框，选中的路径填回这一行', async () => {
    const { host, sent } = await open({}, { [PICK_FOLDER_URL]: { status: 200, body: { path: 'F:\\Picked' } } });
    await click(rows(host)[0]!.querySelector('button[aria-label="폴더 선택"]'));
    await settle();
    expect(sent(PICK_FOLDER_URL)).toEqual({ initial: 'D:\\Videos' });
    expect(paths(host)[0]!.value).toBe('F:\\Picked');
  });

  it('任一行选了云盘才出挂载说明与缺的软件', async () => {
    const { host } = await open();
    expect(host.textContent).not.toContain('挂载帮助');
    await choose(rows(host)[0]!.querySelector('[aria-haspopup="listbox"]'), 'CloudDrive · 115');
    expect(host.textContent).toContain('先在 CloudDrive 登录网盘并完成挂载。');
    expect(host.querySelector('a[href="https://winfsp.dev/rel/"]')?.textContent).toContain('下载 WinFsp');
    await choose(rows(host)[0]!.querySelector('[aria-haspopup="listbox"]'), '로컬 디스크');
    expect(host.textContent).not.toContain('挂载帮助');
  });

  it('其它系统每行多一格 Windows 中的对应路径', async () => {
    const { host } = await open({ windows: false, media_root: { label: 'Windows 中的对应路径', placeholder: '例如 B:\\' } });
    expect(rows(host)[0]!.textContent).toContain('Windows 中的对应路径');
  });
});

describe('填错时原位标错', () => {
  it('目录按行、高级设置里的错误把折叠展开，已填的都留着，焦点落到第一个错处', async () => {
    const { host } = await open({}, { [SETUP_URL]: { status: 400, body: {
      error: '有几项需要修改', errors: { media_dir: ['目录不存在：D:\\Nope'], port: '端口要是 1 到 65535 之间的整数' } } } });
    await type(paths(host)[0], 'D:\\Nope');
    await type(field(host, 'port'), '70000');
    await submitForm(host);
    await act(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    expect(rows(host)[0]!.textContent).toContain('目录不存在：D:\\Nope');
    expect(paths(host)[0]!.getAttribute('aria-invalid')).toBe('true');
    expect(advanced(host)?.getAttribute('aria-expanded')).toBe('true');
    expect(field(host, 'port')?.value).toBe('70000');
    expect(field(host, 'port')?.getAttribute('aria-invalid')).toBe('true');
    expectAnnounced(host, paths(host)[0], '目录不存在：D:\\Nope');
    expectAnnounced(host, field(host, 'port'), '端口要是 1 到 65535 之间的整数');
    expect(document.activeElement).toBe(paths(host)[0]);
  });

  it('整表不成立的那一句写在目录区上方，不挂到某一行', async () => {
    const { host } = await open({}, { [SETUP_URL]: { status: 400, body: {
      error: '有几项需要修改', errors: { media_dir: ['请添加 1 到 100 个媒体文件夹'] } } } });
    await click(buttonNamed('미디어 라이브러리 추가', host));
    await submitForm(host);
    const [alert, ...more] = alertsWith(host, '请添加 1 到 100 个媒体文件夹');
    expect(alert).toBeDefined();
    expect(more).toHaveLength(0);
    expect(occurrences(host, '请添加 1 到 100 个媒体文件夹')).toBe(1);
    expect(rows(host).some((row) => row.contains(alert!))).toBe(false);
    expect(alert!.compareDocumentPosition(rows(host)[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(advanced(host)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('密码的错误挂在密码框下，开关保持打开', async () => {
    const { host } = await open({}, { [SETUP_URL]: { status: 400, body: {
      error: '有几项需要修改', errors: { access_password: '两次输入的访问密码不一致' } } } });
    await type(host.querySelector<HTMLInputElement>('#access-password'), 'first-password');
    await submitForm(host);
    expect(switches(host)[0]!.checked).toBe(true);
    expect(host.querySelector('#access-password')?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('#access-password')?.value).toBe('first-password');
    const first = expectAnnounced(host, host.querySelector('#access-password'), '两次输入的访问密码不一致');
    // 同一句错误再提交一次：提示换成新节点，读屏重新播报，页面上仍只有一份。
    await submitForm(host);
    const second = expectAnnounced(host, host.querySelector('#access-password'), '两次输入的访问密码不一致');
    expect(second).not.toBe(first);
  });
});

describe('完成态', () => {
  it('成功后同一页换成完成态：扫描说明、入口链接、运行信息默认收起', async () => {
    const { host } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
    await submitForm(host);
    expect(host.querySelector('h1')?.textContent).toBe('설정 완료');
    expect(host.textContent).toContain('컬렉션을 시작하는 중입니다.');
    expect(host.textContent).toContain('첫 스캔이 대기열에 추가되었습니다. 백그라운드에서 미디어 라이브러리를 정리하는 동안에도 Peach를 사용할 수 있습니다.');
    const entry = [...host.querySelectorAll('a')].find((link) => link.textContent === 'Peach 시작');
    expect(entry?.getAttribute('href')).toBe('http://127.0.0.1:8900/?onboarding=1');
    expect(document.activeElement).toBe(entry);
    const facts = [...host.querySelectorAll('summary')].find((node) => node.textContent === '실행 정보');
    expect(facts?.getAttribute('aria-expanded')).toBe('false');
    expect(document.title).toBe('Peach · 설정 완료');
  });

  it('选了导入浏览器历史又没扫描时，入口换成导入历史', async () => {
    const { host } = await open({}, { [SETUP_URL]: { status: 200, body: done({
      url: 'http://127.0.0.1:8900/taste?onboarding=1', scan_requested: false, history_guide: true }) } });
    await submitForm(host);
    expect(host.textContent).toContain('나중에 설정 페이지에서 미디어 라이브러리 스캔을 시작하세요.');
    const entry = [...host.querySelectorAll('a')].find((link) => link.textContent === '브라우저 방문 기록 가져오기');
    expect(entry?.getAttribute('href')).toBe('http://127.0.0.1:8900/taste?onboarding=1');
  });

  it('独立包给了跳转地址：等满与配置页同一个时长再跳', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { host } = await open({}, { [SETUP_URL]: { status: 200, body: done({
      standalone: true, redirect: 'http://127.0.0.1:8900/?onboarding=1' }) } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await submitForm(host);
    await act(async () => { vi.advanceTimersByTime(RESTART_REDIRECT_MS - 1) });
    expect(assign).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1) });
    expect(assign).toHaveBeenCalledWith('http://127.0.0.1:8900/?onboarding=1');
  });

  it('源码部署不给跳转地址，页面不自己跳', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { host } = await open({}, { [SETUP_URL]: { status: 200, body: done() } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await submitForm(host);
    await act(async () => { vi.advanceTimersByTime(RESTART_REDIRECT_MS * 2) });
    expect(assign).not.toHaveBeenCalled();
  });
});

it('别的设备打开时读题接口回 403，只说去哪里打开、不画表单', async () => {
  server({ [SETUP_QUESTIONS_URL]: { status: 403, body: { error: 'setup is loopback-only' } } });
  const host = await mount(<SetupPage />);
  await settle();
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Peach가 실행 중인 이 컴퓨터에서 설정을 여세요.');
});

it('读题失败时给原因和重试', async () => {
  const { fetcher } = server({ [SETUP_QUESTIONS_URL]: [
    { status: 500, body: { error: '服务出错了' } }, { status: 200, body: questions() }] });
  const host = await mount(<SetupPage />);
  await settle();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('服务出错了');
  await click(buttonNamed('다시 시도', host));
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(paths(host)).toHaveLength(1);
});

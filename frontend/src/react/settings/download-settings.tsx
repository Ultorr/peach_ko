/* 「云下载」：把磁力交给 115 或 PikPak 离线下载，文件落在已挂载的网盘目录，由推送发现入库。
 *
 * 两张卡。第一张是地址、令牌、目标目录与等待上限：115 走 CloudDrive2 的 gRPC，令牌在
 * CloudDrive2「设置 → API 令牌」里生成。检查去问 CloudDrive2 有没有离线权限、目标目录能不能
 * 离线、115 还剩几条配额，只读，不提交：地址和令牌都已保存时卡片一打开就按已保存的配置查一遍，
 * 「保存配置」的响应里也带着一份，「检查」键按此刻填的值重查。115 目标目录留空保存时，服务端按
 * 推送发现推一个目录，已经存在就直接存上。地址、还没存的目标目录与 PikPak 根留空时，检查把
 * 探测到的、按推送发现推出的值填回表单，点「保存配置」才落盘；推出的目录不存在时给一颗
 * 「新建这个目录」，只有点了才在 CloudDrive2 里建。第二张是 PikPak 账号，提供账号密码与浏览器登录。
 *
 * 令牌与密码只往本机凭据文件写，读接口只回「存没存过」，所以令牌框保存后清空、提示改成
 * 「已保存，留空不改」。PikPak 要人机验证时服务端回一个验证页地址，这里给出链接让用户在浏览器
 * 里完成，Peach 不替他过验证。 */
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';

import { apiGet, apiSend, errorMessage } from '../../api';
import type {
  ConfigurationPanel, DownloadCheckReport, DownloadConfig, DownloadSaveResult, DownloadSettingsState, PikPakLoginResult,
} from '../bundle';
import { LoadingDots } from '../components/loading-dots';
import { Note } from '../components/note';
import { SourceLabel, PROVIDER_ICONS } from '../components/source-label';
import { groupRoot } from './configuration-panel';
import {
  ErrorText, ExternalLink, Fact, FactList, FieldLabel, Footer, Help, Section, Stack,
} from './section';
import { busyProps, useAction } from './use-action';
import { JavBrowserSettings } from './jav-browser-settings';

export const DOWNLOADS_URL = '/api/configuration/downloads';
const CHECK_URL = '/api/configuration/downloads/check';
const FOLDER_URL = '/api/configuration/downloads/folder';
const LOGIN_URL = '/api/configuration/downloads/pikpak/login';
const LOGOUT_URL = '/api/configuration/downloads/pikpak/logout';
const BROWSER_URL = '/api/configuration/downloads/pikpak/browser-login';
const POLL_MS = 2000;

/** 「下载渠道」分组：CloudDrive2 与 PikPak 账号。 */
export function DownloadGroup({ initial, receipt, panel }: {
  initial: DownloadSettingsState;
  receipt(message: string): void;
  panel?: ConfigurationPanel;
}) {
  return (
    <div {...groupRoot(panel)}>
      <DownloadSettings initial={initial} receipt={receipt} />
    </div>
  );
}

export function DownloadSettings({ initial, receipt }: {
  initial: DownloadSettingsState;
  receipt(message: string): void;
}) {
  const [state, setState] = useState(initial);
  // 账号框放在上面这一层：云下载卡要知道用户有没有在用 PikPak，没在用就不报 PikPak 根的提示。
  const [username, setUsername] = useState('');
  const pikpakAccount = state.pikpak.logged_in || Boolean(username.trim());
  return (
    <>
      <DownloadForm state={state} settle={setState} receipt={receipt} pikpakAccount={pikpakAccount} />
      <PikPakAccount state={state} settle={setState} receipt={receipt} username={username} setUsername={setUsername} />
      <JavBrowserSettings receipt={receipt} refreshKey={JSON.stringify([
        state.config, state.token_set, state.pikpak.logged_in,
      ])} />
    </>
  );
}

interface CardProps {
  state: DownloadSettingsState;
  settle(next: DownloadSettingsState): void;
  receipt(message: string): void;
}

function DownloadForm({ state, settle, receipt, pikpakAccount }: CardProps & { pikpakAccount: boolean }) {
  const [config, setConfig] = useState<DownloadConfig>(state.config);
  const [token, setToken] = useState('');
  const [hours, setHours] = useState(String(state.config.wait_hours));
  const [report, setReport] = useState<DownloadCheckReport | null>(null);
  const [detected, setDetected] = useState('');
  const [suggested, setSuggested] = useState<Suggestions>(NO_SUGGESTIONS);
  const [failure, setFailure] = useState('');
  const [saveBlocked, setSaveBlocked] = useState(false);
  const action = useAction();
  const target = (key: '115' | 'pikpak') => config.targets[key] ?? '';
  const setTarget = (key: '115' | 'pikpak', value: string) =>
    setConfig({ ...config, targets: { ...config.targets, [key]: value } });
  // 检查标为不存在、用户也没改过的那个目录，存下来提交时只会报「没有这个文件夹」。
  const missing = Boolean(suggested.target && !suggested.target.exists && target('115') === suggested.target.path);

  // 把一份检查报告落到表单上：留空的地址、115 目标目录与 PikPak 根填建议值，用户填过的不覆盖。
  // `saved` 是服务端保存时已经存上的 115 目标目录，它不再填回、也不再说「保存配置后生效」。
  const show = (next: DownloadCheckReport, blank: Blanks, saved = '') => {
    const folder = blank.target ? next.suggested_target : null;
    const stored = Boolean(folder && saved && folder.path === saved);
    const root = blank.root ? next.suggested_pikpak_root : '';
    setConfig((current) => ({
      ...current,
      clouddrive_address: blank.address && next.address ? next.address : current.clouddrive_address,
      targets: folder && !stored ? { ...current.targets, '115': folder.path } : current.targets,
      pikpak_root: root || current.pikpak_root,
    }));
    setReport(next);
    setDetected(blank.address ? next.address : '');
    setSuggested({ target: folder, root, saved: stored });
    setSaveBlocked(false);
    setFailure('');
  };

  // 地址和令牌都已保存时，卡片一打开就按已保存的配置查一遍；令牌只在服务端取，不经页面。
  useEffect(() => {
    if (!state.available || !state.config.clouddrive_address || !state.token_set) return;
    const blank = { address: false, target: !state.config.targets['115'], root: !state.config.pikpak_root };
    void action.run('auto', (signal) => apiGet<DownloadCheckReport>(CHECK_URL, signal),
      (next) => show(next, blank), (cause) => setFailure(errorMessage(cause)));
    // 只在挂载时查这一次，之后由「保存配置」与「检查」接手。
  }, []);

  // 保存的响应里带着按已保存配置做的检查报告，直接渲染；115 目标目录留空时服务端已按推送发现填上。
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (missing) {
      setSaveBlocked(true);
      return;
    }
    const blankTarget = !target('115').trim();
    const body = { ...config, wait_hours: hours, token, pikpak_account: pikpakAccount };
    void action.run('save', (signal) => apiSend<DownloadSaveResult>(DOWNLOADS_URL, body, 'POST', signal),
      (next) => {
        const { report: checked, ...settings } = next;
        settle(settings);
        setConfig(settings.config);
        setHours(String(settings.config.wait_hours));
        setToken('');
        if (checked) {
          show(checked, { address: !settings.config.clouddrive_address, target: blankTarget,
            root: !settings.config.pikpak_root }, settings.config.targets['115'] ?? '');
        } else {
          setReport(null);
          setDetected('');
          setSuggested(NO_SUGGESTIONS);
          setSaveBlocked(false);
          setFailure('');
        }
        receipt("설정이 저장되었습니다");
      }, (cause) => setFailure(errorMessage(cause)));
  };

  // 「检查」按此刻填的值重查：地址留空时服务端探测本机端口，目录留空时按推送发现推建议值。
  const check = () => {
    const blank = { address: !config.clouddrive_address.trim(), target: !target('115').trim(),
      root: !config.pikpak_root };
    const body = { clouddrive_address: config.clouddrive_address, token, target: target('115'),
      pikpak_root: config.pikpak_root, pikpak_account: pikpakAccount };
    void action.run('check', (signal) => apiSend<DownloadCheckReport>(CHECK_URL, body, 'POST', signal),
      (next) => show(next, blank), (cause) => setFailure(errorMessage(cause)));
  };

  // 只在用户点了「新建这个目录」时调 CloudDrive2 建目录，建好后服务端按这个目录再检查一遍。
  const create = (path: string) => {
    const body = { clouddrive_address: config.clouddrive_address, token, path, pikpak_root: config.pikpak_root,
      pikpak_account: pikpakAccount };
    void action.run('folder', (signal) => apiSend<DownloadCheckReport>(FOLDER_URL, body, 'POST', signal),
      (next) => {
        setReport(next);
        setSuggested((current) => ({ ...current, target: { path, exists: true } }));
        setSaveBlocked(false);
        setFailure('');
        receipt("폴더가 생성되었습니다");
      }, (cause) => setFailure(errorMessage(cause)));
  };

  return (
    <Section title="클라우드 다운로드" onSubmit={submit}>
      <Stack>
        <Input label="CloudDrive2 주소" placeholder="비워 두면 자동 검색" autoComplete="off" maxLength={200}
          value={config.clouddrive_address} isDisabled={!state.available}
          onChange={(value) => setConfig({ ...config, clouddrive_address: value })} />
        <Input label="CloudDrive2 API 토큰" type="password" autoComplete="off" maxLength={400}
          placeholder={state.token_set ? "저장됨. 비워 두면 유지" : "CloudDrive2의 「설정 → API 토큰」에서 생성"}
          hint="오프라인 작업 권한이 필요합니다."
          value={token} isDisabled={!state.available} onChange={setToken} />
        <Input label={<SourceLabel source="115" label="115 대상 폴더" />} placeholder="비워 두면 푸시로 발견한 정보를 자동 입력" autoComplete="off" maxLength={300}
          validationBehavior="aria" isInvalid={missing}
          hint={missing ? (saveBlocked ? "먼저 이 폴더를 만들거나 기존 폴더를 입력하세요." : "이 폴더가 없습니다.") : "자동 라이브러리 추가에 사용할 클라우드 경로 접두사 아래에 있어야 합니다."}
          value={target('115')} isDisabled={!state.available} onChange={(value) => setTarget('115', value)} />
        <Input label={<SourceLabel source="pikpak" label="PikPak 대상 폴더" />} placeholder="/로 시작하는 클라우드 드라이브 경로" autoComplete="off" maxLength={300}
          hint="이미 존재하는 폴더여야 합니다."
          value={target('pikpak')} isDisabled={!state.available} onChange={(value) => setTarget('pikpak', value)} />
        <div className="flex flex-col gap-1">
          <FieldLabel><SourceLabel source="pikpak" label="PikPak 루트 폴더에 대응하는 미디어 폴더" /></FieldLabel>
          {state.pikpak_roots.length ? (
            <Select aria-label="PikPak 루트 폴더에 대응하는 미디어 폴더" selectedKey={config.pikpak_root || null}
              isDisabled={!state.available} placeholder="확인 시 푸시로 발견한 정보에 따라 선택"
              onSelectionChange={(key) => setConfig({ ...config, pikpak_root: key === null ? '' : String(key) })}>
              {state.pikpak_roots.map((root) => <SelectItem key={root} id={root}>{root}</SelectItem>)}
            </Select>
          ) : (
            <Help>먼저 「미디어 라이브러리 및 추가」에서 PikPak 마운트 폴더를 추가하세요.</Help>
          )}
        </div>
        <Input label="대기 시간 한도(시간)" type="number" inputMode="numeric" autoComplete="off"
          hint={`시간 초과 시 정체 상태로 표시합니다. 입력 범위: 1~${state.max_wait_hours} 시간.`}
          value={hours} isDisabled={!state.available} onChange={setHours} />
      </Stack>
      {action.busy === 'auto' ? <Stack divided><LoadingDots label="CloudDrive2 확인 중" /></Stack> : null}
      {report ? (
        <CheckReport report={report} detected={detected} suggested={suggested}
          create={state.available ? create : undefined} creating={action.busy === 'folder'} />
      ) : null}
      {failure || action.error ? <Stack divided><ErrorText>{failure || action.error}</ErrorText></Stack> : null}
      <Footer status={state.available ? undefined : "클라우드 다운로드는 원장을 기록하는 기기에서만 사용할 수 있습니다."}>
        <Button variant="secondary" onClick={check} disabled={!state.available} {...busyProps(action.busy === 'check')}>연결 확인</Button>
        <Button type="submit" disabled={!state.available} {...busyProps(action.busy === 'save')}>설정 저장</Button>
      </Footer>
    </Section>
  );
}

/** 这一次检查推出的建议值。目标目录不存在时也填回去，表单把它标成无效；`saved` 为真时目标目录
 *  已经由保存配置存上。 */
interface Suggestions {
  target: DownloadCheckReport['suggested_target'];
  root: string;
  saved: boolean;
}

const NO_SUGGESTIONS: Suggestions = { target: null, root: '', saved: false };

/** 哪些字段留空，留空的才填建议值。 */
interface Blanks {
  address: boolean;
  target: boolean;
  root: boolean;
}

function CheckReport({ report, detected, suggested, create, creating }: {
  report: DownloadCheckReport;
  detected: string;
  suggested: Suggestions;
  create?: (path: string) => void;
  creating: boolean;
}) {
  const folder = suggested.target;
  return (
    <Stack divided>
      <FactList>
        {detected ? <Fact term="CloudDrive2 주소">{`감지됨: ${detected}, 설정을 저장하면 적용됩니다`}</Fact> : null}
        {folder?.exists ? (
          <Fact term={<SourceLabel source="115" label="115 대상 폴더" />}>
            {suggested.saved ? `푸시로 발견한 정보 입력 완료: ${folder.path}` : `푸시로 발견한 정보 입력: ${folder.path}, 설정을 저장하면 적용됩니다`}
          </Fact>
        ) : null}
        {folder && !folder.exists ? (
          <Fact term={<SourceLabel source="115" label="115 대상 폴더" />}>
            {`${folder.path} 없음`}
            {create ? <Button variant="secondary" size="small" onClick={() => create(folder.path)} {...busyProps(creating)}>이 폴더 만들기</Button> : null}
          </Fact>
        ) : null}
        {suggested.root ? <Fact term={<SourceLabel source="pikpak" label="PikPak 루트 폴더" />}>{`푸시로 발견한 정보 입력: ${suggested.root}, 설정을 저장하면 적용됩니다`}</Fact> : null}
        {report.permissions.length ? (
          <Fact term="오프라인 권한">
            <Chip variant="caption" color={report.missing.length ? 'yellow' : 'lime'}>
              {report.missing.length ? `누락:${report.missing.join('、')}` : "모두 있음"}
            </Chip>
          </Fact>
        ) : null}
        {report.folder ? (
          <Fact term="대상 폴더">{report.folder.can_offline ? `${report.folder.path} 오프라인 다운로드 가능` : `${report.folder.path} 오프라인 다운로드 미지원`}</Fact>
        ) : null}
        {report.quota ? (
          <Fact term={<SourceLabel source="115" label="115 오프라인 할당량" />}>{`이번 달 잔여 ${report.quota.left} 개 남음, 전체 ${report.quota.total} 개`}</Fact>
        ) : null}
      </FactList>
      {report.problems.map((problem) => <ErrorText key={problem}>{problem}</ErrorText>)}
    </Stack>
  );
}

/** PikPak 账号卡。主路径是「用浏览器登录」（ADR-0093）：服务端拉起一个 Peach 专用的浏览器窗口，
 *  用户在里面登录，Peach 取走网页端会话后关窗，之后只由 Peach 续期。这里拉起后每两秒读一次状态，
 *  直到登好、取消、超时或失败。账号密码表单直接显示，登录方式在底栏选择。 */
function PikPakAccount({ state, settle, receipt, username, setUsername }: CardProps & {
  username: string;
  setUsername(value: string): void;
}) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [failure, setFailure] = useState('');
  // 只报这一页里拉起的那次登录怎么收场；服务端留着的上一次结果不当成新消息。
  const [outcome, setOutcome] = useState('');
  const action = useAction();
  const account = state.pikpak;
  const browser = state.pikpak_browser;
  const waiting = browser.state === 'waiting';

  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await apiGet<DownloadSettingsState>(BROWSER_URL, controller.signal);
        if (controller.signal.aborted) return;
        settle(next);
        if (next.pikpak_browser.state === 'done') receipt("PikPak에 로그인되었습니다");
        else if (next.pikpak_browser.state !== 'waiting') setOutcome(next.pikpak_browser.message);
        if (next.pikpak_browser.state !== 'waiting') return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFailure(errorMessage(cause));
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [waiting]);

  const openBrowser = () => {
    setOutcome('');
    void action.run('browser', (signal) => apiSend<DownloadSettingsState>(BROWSER_URL, {}, 'POST', signal),
      (next) => { settle(next); setFailure(''); }, (cause) => setFailure(errorMessage(cause)));
  };

  const cancelBrowser = () => {
    void action.run('cancel', (signal) => apiSend<DownloadSettingsState>(`${BROWSER_URL}/cancel`, {}, 'POST', signal),
      (next) => { settle(next); setFailure(''); setOutcome(next.pikpak_browser.message); },
      (cause) => setFailure(errorMessage(cause)));
  };

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (account.logged_in) return;
    const body = { username, password, remember };
    void action.run('login', (signal) => apiSend<PikPakLoginResult>(LOGIN_URL, body, 'POST', signal),
      (result) => {
        settle(result.settings);
        setFailure('');
        if (!result.ok) {
          setCaptcha(result.captcha_url ?? '');
          return;
        }
        setCaptcha('');
        setPassword('');
        receipt("PikPak에 로그인되었습니다");
      }, (cause) => setFailure(errorMessage(cause)));
  };

  const logout = () => {
    void action.run('logout', (signal) => apiSend<DownloadSettingsState>(LOGOUT_URL, {}, 'POST', signal),
      (next) => { settle(next); setFailure(''); receipt("PikPak에서 로그아웃되었습니다"); },
      (cause) => setFailure(errorMessage(cause)));
  };

  const passwordForm = (
    <>
      <Input label="계정" placeholder="이메일 또는 휴대전화 번호" autoComplete="username" maxLength={200}
        value={username} isDisabled={!state.available} onChange={setUsername} />
      <Input label="비밀번호" type="password" autoComplete="current-password" maxLength={200}
        value={password} isDisabled={!state.available} onChange={setPassword} />
      <Checkbox isSelected={remember} isDisabled={!state.available} onChange={setRemember}>
        비밀번호를 저장하고 로그인 만료 시 자동으로 다시 로그인
      </Checkbox>
      {captcha ? (
        <Note tone="warning" title="사람 인증이 필요합니다"
          extra={<div className="pt-2"><ExternalLink href={captcha}>PikPak 인증 페이지 열기</ExternalLink></div>}>
          브라우저에서 인증을 마친 후 여기로 돌아와 「로그인」을 다시 누르세요.
        </Note>
      ) : null}
    </>
  );
  const passwordLogin = (
    <Button type="submit" disabled={!state.available || waiting} {...busyProps(action.busy === 'login')}>로그인</Button>
  );
  const outcomeFailed = browser.state === 'timeout' || browser.state === 'failed';

  return (
    <Section title="PikPak 계정" icon={<PROVIDER_ICONS.pikpak />} onSubmit={login}>
      {account.logged_in ? (
        <FactList>
          <Fact term="계정">{account.username || "로그인됨"}</Fact>
          {account.method === 'browser' ? (
            <Fact term="로그인 방식">브라우저 로그인, Peach에서 세션 갱신</Fact>
          ) : (
            <Fact term="비밀번호">{account.remember ? "저장됨. 로그인 만료 시 자동으로 다시 로그인" : "저장하지 않음. 로그인 만료 후 여기로 돌아와 다시 로그인해야 합니다"}</Fact>
          )}
        </FactList>
      ) : (
        <Stack>
          {outcome ? (outcomeFailed ? <ErrorText>{outcome}</ErrorText> : <Help role="status">{outcome}</Help>) : null}
          {passwordForm}
        </Stack>
      )}
      {failure || action.error ? <Stack divided><ErrorText>{failure || action.error}</ErrorText></Stack> : null}
      <Footer status={!account.logged_in && waiting
        ? <LoadingDots label={browser.message || "브라우저 창에서 PikPak에 로그인하기를 기다리는 중"} /> : null}>
        {account.logged_in ? (
          <Button variant="secondary" onClick={logout} disabled={!state.available} {...busyProps(action.busy === 'logout')}>로그아웃</Button>
        ) : <>{passwordLogin}{!browser.available ? null : waiting ? (
          <Button variant="secondary" type="button" onClick={cancelBrowser} {...busyProps(action.busy === 'cancel')}>취소</Button>
        ) : (
          <Button type="button" onClick={openBrowser} disabled={!state.available}
            {...busyProps(action.busy === 'browser')}>브라우저로 로그인</Button>
        )}</>}
      </Footer>
    </Section>
  );
}

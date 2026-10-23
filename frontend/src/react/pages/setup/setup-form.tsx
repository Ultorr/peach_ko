/* 首次设置表单。题目、默认值、显隐与随平台变化的文案来自 `GET /api/setup/questions`；
 * 分组标题、按钮与「完成设置后」那一组是页面骨架，写在这里。
 *
 * 提交走 `POST /api/setup`。400 的 `errors` 按题目 key 写回原位：媒体文件夹按行对齐，整表不成立
 * 的那一句放在目录区上方；高级设置里任一项出错就展开它；访问密码出错时开关保持打开。已填的
 * 内容都留在原地，焦点落到第一个标错的框。 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Radio } from 'react-aria-components';
import { RiAddLine } from '@remixicon/react';

import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Label } from '@/components/base/input/label';
import { Switch } from '@/components/base/switch/switch';

import { SEGMENT, SEGMENTED_TRACK, SegmentedRadioGroup } from '../../components/segmented';
import { busyProps } from '../../settings/busy-props';
import { FolderRow, isCloudSource, MediaReadPolicy, MediaReadPolicyHelp, SourceSelect, useFolderRows, WindowsRootInput } from '../../settings/folder-rows';
import { PasswordPair } from '../../settings/password-pair';
import { ReportingChoices } from '../../settings/remote-reporting-settings';
import { Disclosure, ErrorText, ExternalLink, Help } from '../../settings/section';
import { CardGroup, GroupTitle } from '../auth-card';
import {
  describeFailure, pickFolder, SetupRequestError, submitSetup,
  type SetupDone, type SetupErrors, type SetupFolder, type SetupQuestion, type SetupQuestions, type SetupSubmission,
} from './setup-api';

/** 这几项出错时「高级设置」自己展开：错在折叠里的框，人看不见。 */
const ADVANCED_KEYS = ['data_root', 'host', 'port', 'mdns_name'];

/** 媒体文件夹那一项的错误：与行数对得上就按行写回，否则是整表一句。 */
function folderErrors(value: SetupErrors[string], count: number): { rows: string[]; table: string } {
  if (Array.isArray(value)) {
    return value.length === count ? { rows: value, table: '' } : { rows: [], table: value.filter(Boolean).join(' ') };
  }
  return { rows: [], table: value ?? '' };
}

function scanLabel(paths: string[]): string {
  if (!paths.length) return "설정 완료 후 스캔 및 정보 보완";
  if (paths.length === 1) return `설정 완료 후 스캔 및 정보 보완:${paths[0]}`;
  return `설정 완료 후 ${paths.length} 개 폴더 스캔 및 정보 보완`;
}

const text = (value: SetupErrors[string]) => (Array.isArray(value) ? value.filter(Boolean).join(' ') : value ?? '');

export function SetupForm({ setup, onDone }: { setup: SetupQuestions; onDone: (done: SetupDone) => void }) {
  const media = setup.questions.find((question) => question.input === 'folders');
  const others = setup.questions.filter((question) => question.input !== 'folders');
  const sources = setup.media_sources.map(({ value, label }) => [value, label] as const);
  const blank = (path = ''): SetupFolder => ({ path, location: setup.media_source_default, root: '', cost: setup.media_source_default === 'local' ? 'free' : '' });
  const folders = useFolderRows<SetupFolder>({
    initial: () => [blank(media?.default ?? '')], blank: () => blank(), pickFolder, describe: describeFailure,
    focusAfterPick: true,
  });
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(others.map((question) => [question.key, question.default])));
  const [accessOn, setAccessOn] = useState(setup.access_enabled);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [scanNow, setScanNow] = useState(setup.scan_now);
  const [historyGuide, setHistoryGuide] = useState(setup.history_guide);
  const [reporting, setReporting] = useState(setup.remote_reporting);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [tableError, setTableError] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [requireReadPolicy, setRequireReadPolicy] = useState(false);
  // 每次因为错误要展开就换一个 key：折叠按初始状态展开，已填的值都在这一层的 state 里。
  const [advancedOpenings, setAdvancedOpenings] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // 写回之后焦点交给第一个标错的框。错误在 await 之后才到，React 不在点击那一刻同步提交，
  // 所以等这一轮落到 DOM 上再找，不赌下一帧之前一定画完。
  const [errorRound, setErrorRound] = useState(0);
  useEffect(() => {
    if (errorRound) form.current?.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus();
  }, [errorRound]);
  // 写回的错误放进框下的提示：`role="alert"` 让读屏在它出现时播报一次，提示本身仍由
  // `aria-describedby` 挂在框上，文字在页面上只有这一份。`key` 跟着提交轮次换，同一句错误
  // 再提交一次也会重新播报。
  const announce = (message: string | undefined) =>
    message ? <span key={errorRound} role="alert">{message}</span> : undefined;

  const visible = (question: SetupQuestion) =>
    !question.visible_when || Object.entries(question.visible_when).every(([key, value]) => values[key] === value);
  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const missing = folders.rows.findIndex((row) => !row.cost);
    if (missing >= 0) {
      setRequireReadPolicy(true);
      requestAnimationFrame(() => form.current?.querySelector<HTMLButtonElement>(`[data-media-read-policy="${missing}"] button`)?.focus());
      return;
    }
    setBusy(true);
    setFailure('');
    const submission: SetupSubmission = {
      media_dir: folders.rows, access_enabled: accessOn, scan_now: scanNow, history_guide: historyGuide,
      ...(reporting ? { remote_reporting: { usage: reporting.usage, errors: reporting.errors } } : {}),
    };
    // 隐藏的题不提交，服务端按题目默认值补上。
    for (const question of others) if (visible(question)) submission[question.key] = values[question.key] ?? '';
    if (accessOn) Object.assign(submission, { access_password: password, access_confirm: confirmation });
    try {
      onDone(await submitSetup(submission));
    } catch (cause) {
      if (cause instanceof SetupRequestError && cause.status === 400 && cause.errors) {
        const found = cause.errors;
        const { rows, table } = folderErrors(found.media_dir, folders.rows.length);
        folders.setErrors(rows);
        setTableError(table);
        setErrors(found);
        if (ADVANCED_KEYS.some((key) => found[key])) setAdvancedOpenings((count) => count + 1);
        if (found.access_password) setAccessOn(true);
        setErrorRound((count) => count + 1);
      } else {
        setFailure(describeFailure(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (question: SetupQuestion) => {
    const error = text(errors[question.key]);
    const help = question.help.join('');
    if (question.input === 'choice') {
      const labelId = `setup-${question.key}-label`;
      return (
        <div key={question.key} className="flex flex-col gap-1.5">
          <Label id={labelId} elementType="span">{question.label}</Label>
          <SegmentedRadioGroup aria-labelledby={labelId} orientation="horizontal" className={SEGMENTED_TRACK}
            value={values[question.key] ?? question.default} onChange={(value) => setValue(question.key, value)}>
            {(question.options ?? []).map((option) => (
              <Radio key={option.value} value={option.value} className={SEGMENT}>{option.label}</Radio>
            ))}
          </SegmentedRadioGroup>
          {help ? <Help>{help}</Help> : null}
          {error ? <ErrorText key={errorRound}>{error}</ErrorText> : null}
        </div>
      );
    }
    const Suffix = () => <span className="shrink-0 pr-1 text-body-regular text-text-secondary">{question.suffix}</span>;
    return (
      <Input key={question.key} id={`f-${question.key}`} label={question.label} isRequired={question.required}
        inputMode={question.input === 'number' ? 'numeric' : undefined} autoComplete="off" spellCheck="false"
        value={values[question.key] ?? ''} onChange={(value) => setValue(question.key, value)}
        leadingAddon={question.prefix
          ? <span className="shrink-0 pl-1 text-body-regular text-text-secondary">{question.prefix}</span>
          : undefined}
        trailingIcon={question.suffix ? Suffix : undefined}
        validationBehavior="aria" isInvalid={Boolean(error)} hint={announce(error) ?? (help || undefined)} />
    );
  };

  const filled = folders.rows.map((row) => row.path.trim()).filter(Boolean);
  const cloud = folders.rows.some((row) => isCloudSource(row.location));
  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} aria-labelledby="auth-card-title"
      className="flex flex-col gap-6">
      {media ? (
        <CardGroup first labelledBy="setup-media-title">
          <GroupTitle id="setup-media-title">
            {media.label}<span aria-hidden className="ml-0.5 text-text-error-primary">*</span>
          </GroupTitle>
          {tableError ? <ErrorText key={errorRound}>{tableError}</ErrorText> : null}
          <div role="group" aria-labelledby="setup-media-title" className="flex flex-col gap-3">
            {folders.rows.map((row, index) => (
              <FolderRow key={index} label={`${media.label} ${index + 1}`} path={row.path}
                onPath={(path) => folders.edit(index, { path })} error={announce(folders.errors[index])}
                inputRef={folders.inputRef(index)} picking={folders.picking === index}
                onPick={() => void folders.pick(index)}
                onRemove={folders.rows.length > 1 ? () => { folders.remove(index); addButton.current?.focus(); } : undefined}>
                <SourceSelect index={index} value={row.location} options={sources}
                  onChange={(location) => folders.edit(index, { location, cost: location === 'local' ? 'free' : '' })} />
                <MediaReadPolicy index={index} cost={row.cost ?? ''}
                  error={requireReadPolicy && !row.cost ? "미디어 읽기 정책을 선택하세요" : undefined}
                  onChange={(cost) => folders.edit(index, { cost })} />
                {setup.media_root
                  ? <WindowsRootInput label={setup.media_root.label} placeholder={setup.media_root.placeholder}
                      value={row.root} onChange={(root) => folders.edit(index, { root })} />
                  : null}
              </FolderRow>
            ))}
          </div>
          <Button ref={addButton} variant="secondary" leadingIcon={RiAddLine} className="self-start" onClick={folders.add}>
            미디어 라이브러리 추가
          </Button>
          {cloud ? (
            <>
              <MediaReadPolicyHelp />
              <Help>{setup.cloud.help}<ExternalLink href={setup.cloud.link.url}>{setup.cloud.link.label}</ExternalLink></Help>
              {setup.cloud.dependencies.map((dependency) => (
                <Help key={dependency.name}>
                  {dependency.message}<ExternalLink href={dependency.download_url}>{dependency.download_label}</ExternalLink>
                </Help>
              ))}
            </>
          ) : null}
          {media.help.map((line) => <Help key={line}>{line}</Help>)}
        </CardGroup>
      ) : null}

      <CardGroup labelledBy="setup-access-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <GroupTitle id="setup-access-title">접속 비밀번호</GroupTitle>
            <p id="setup-access-description" className="text-body-2-regular text-text-secondary">켜면 Peach에 접속할 때 먼저 로그인해야 합니다.</p>
          </div>
          <Switch aria-labelledby="setup-access-title" aria-describedby="setup-access-description"
            isSelected={accessOn} onChange={setAccessOn} />
        </div>
        <Help>비밀번호를 설정하지 않으면 Peach에 연결할 수 있는 기기에서 바로 접속할 수 있습니다.</Help>
        {accessOn
          ? <PasswordPair label="접속 비밀번호" password={password} confirmation={confirmation}
              onPassword={setPassword} onConfirmation={setConfirmation}
              passwordError={announce(text(errors.access_password))} passwordHint="8~256자를 입력하세요."
              confirmationInvalid={Boolean(errors.access_password)} />
          : null}
      </CardGroup>

      <CardGroup>
        <Disclosure key={advancedOpenings} summary="고급 설정" defaultOpen={advancedOpenings > 0}>
          <div className="flex flex-col gap-4">{others.filter(visible).map(field)}</div>
        </Disclosure>
      </CardGroup>

      <CardGroup labelledBy="setup-options-title">
        <GroupTitle id="setup-options-title">설정 완료 후</GroupTitle>
        <div className="flex flex-col gap-1.5">
          <Checkbox isSelected={scanNow} onChange={setScanNow}>{scanLabel(filled)}</Checkbox>
          <Help>기존 NFO와 표지를 읽고 누락된 정보를 수집합니다. 자동 적용 규칙에 맞는 정보는 처리 완료 후 라이브러리에 반영하며, 나머지 후보는 검토 목록에 남깁니다.</Help>
        </div>
        <section aria-labelledby="setup-history-title" className="flex flex-col gap-1.5 border-t border-separator-border pt-4">
          <h3 id="setup-history-title" className="flex items-center gap-2 text-body-medium text-text-primary">
            브라우저 방문 기록<span className="text-body-2-regular text-text-tertiary">선택 사항</span>
          </h3>
          <Checkbox isSelected={historyGuide} onChange={setHistoryGuide}>이어서 브라우저 방문 기록 가져오기</Checkbox>
          <Help>취향 분석에 사용됩니다. 설정을 완료한 후 이 컴퓨터의 기록을 읽거나 다른 기기의 기록을 가져올 수 있습니다. 나중에 「취향」에서도 시작할 수 있습니다.</Help>
        </section>
      </CardGroup>

      {failure ? <ErrorText>{failure}</ErrorText> : null}
      {reporting ? <CardGroup>
        <GroupTitle>버전 통계 및 오류 진단</GroupTitle>
        <ReportingChoices value={reporting} onChange={setReporting} />
        <Help>컬렉션 및 취향 상세 정보 업로드는 기본적으로 꺼져 있습니다. 「앱 및 유지 관리」에서 확인하고 선택할 수 있습니다.</Help>
      </CardGroup> : null}
      <Button type="submit" className="self-start" {...busyProps(busy)}>설정 완료</Button>
    </form>
  );
}

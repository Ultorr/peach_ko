/* 本机访问密码，由 BoardUI 原版组件组合；表单值只留在提交期间的组件内存中。
 *
 * 字段是 BoardUI `Input`（React Aria TextField），开关是 BoardUI `Checkbox`，提交键是 BoardUI `Button`；
 * 新密码与确认两框是与首启页共用的 `./password-pair`，分区外框与提示用配置页共用的 `./section`。 */
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';

import { ApiError, apiSend, errorMessage } from '../../api';
import type { AccessSettingsProps, AccessState } from '../bundle';
import { Note } from '../components/note';
import { PasswordPair } from './password-pair';
import { ErrorText, Footer, Help, Section, Stack } from './section';
import { busyProps, useAction } from './use-action';

type FieldErrors = Partial<Record<'current_password' | 'password' | 'confirmation', string>>;

const HELP: Partial<Record<AccessState['mode'], string>> = {
  legacy: "현재 시스템이 생성한 접속 암호를 사용하고 있습니다. 직접 비밀번호를 설정하거나 로그인 요구를 끄세요.",
  locked: "접속 설정을 불러올 수 없습니다. 이 기기에서 설정 파일을 확인하세요.",
  password: "비밀번호가 설정되어 있습니다. 새 기기에서는 로그인해야 하며, 로그인 시 「로그인 상태 유지」를 선택하면 30일 동안 유지됩니다.",
};

export function AccessSettings({ initial, receipt }: AccessSettingsProps) {
  const [state, setState] = useState(initial);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [disable, setDisable] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const body = useRef<HTMLDivElement>(null);
  const action = useAction();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issues: FieldErrors = {};
    if (state.mode === 'password' && !current) issues.current_password = "현재 접속 비밀번호를 입력하세요";
    if (!disable) {
      if (password.length < 8 || password.length > 256) issues.password = "접속 비밀번호는 8~256자여야 합니다";
      if (password !== confirmation) issues.confirmation = "입력한 두 비밀번호가 일치하지 않습니다";
    }
    setFields(issues);
    if (Object.keys(issues).length) {
      requestAnimationFrame(() => body.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus());
      return;
    }
    void action.run('save', (signal) => apiSend<AccessState>('/api/configuration/access', {
      revision: state.revision, action: disable ? 'disable' : 'set', confirm_disable: disable,
      current_password: current, password: disable ? '' : password, confirmation: disable ? '' : confirmation,
    }, 'POST', signal), (next) => {
      setState(next); setCurrent(''); setPassword(''); setConfirmation(''); setDisable(false); setFields({});
      receipt(next.mode === 'open' ? "접속 비밀번호 사용이 해제되었습니다" : "설정이 저장되었습니다");
    }, (cause) => {
      const payload = cause instanceof ApiError ? cause.body as { errors?: FieldErrors; detail?: { errors?: FieldErrors } } : null;
      const errors = payload?.errors || payload?.detail?.errors;
      if (errors) setFields(errors); else action.setError(errorMessage(cause));
    });
  };

  const help = HELP[state.mode];
  const editable = state.mode !== 'locked';
  return (
    <Section title="접속 비밀번호" onSubmit={submit}>
      <div ref={body}>
        <Stack>
          {help ? <Help>{help}</Help> : null}
          {state.mode === 'open'
            ? <Note tone="warning" title="접속 비밀번호가 설정되지 않았습니다">Peach에 연결할 수 있는 기기는 주소를 열어 바로 컬렉션을 볼 수 있습니다. 로그인은 필요하지 않습니다.</Note>
            : null}
          {state.mode === 'password' || state.mode === 'legacy'
            ? <Checkbox isSelected={disable} onChange={setDisable}>접속 비밀번호 해제</Checkbox>
            : null}
          {state.mode === 'password'
            ? <Input id="access-current" type="password" label="현재 접속 비밀번호" autoComplete="current-password" maxLength={256}
                value={current} onChange={setCurrent} isRequired validationBehavior="aria"
                isInvalid={Boolean(fields.current_password)} hint={fields.current_password} />
            : null}
          {editable
            ? <PasswordPair label={state.mode === 'password' ? "새 접속 비밀번호" : "접속 비밀번호 설정"}
                password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation}
                disabled={disable} passwordError={fields.password} confirmationError={fields.confirmation}
                passwordHint={disable ? "접속 비밀번호를 해제할 때는 입력하지 않아도 됩니다." : "8자 이상이어야 합니다. 저장하면 다른 기기는 다시 로그인해야 합니다."} />
            : null}
          {disable ? <Note tone="warning" title="접속 범위">저장하면 Peach에 연결할 수 있는 기기에서 컬렉션에 바로 접속할 수 있습니다.</Note> : null}
          {action.error ? <ErrorText>{action.error}</ErrorText> : null}
        </Stack>
      </div>
      {editable
        ? <Footer><Button type="submit" {...busyProps(action.busy === 'save')}>설정 저장</Button></Footer>
        : null}
    </Section>
  );
}

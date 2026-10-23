/* 首次运行页：取题目、画表单，成功后在同一页换成完成态。
 *
 * 题目接口只对运行 Peach 的这台电脑开放；别的设备打开时它回 403，页面不画表单，只说去哪里打开。 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/base/buttons/button';

import { Note } from '../../components/note';
import { AuthCard } from '../auth-card';
import { describeFailure, fetchQuestions, SetupRequestError, type SetupDone, type SetupQuestions } from './setup-api';
import { SetupDoneView } from './setup-done';
import { SetupForm } from './setup-form';
import { SetupRestore } from './setup-restore';

type View =
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'failed'; message: string }
  | { kind: 'form'; setup: SetupQuestions }
  | { kind: 'done'; done: SetupDone };

export function SetupPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchQuestions(controller.signal).then(
      (setup) => setView({ kind: 'form', setup }),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setView(cause instanceof SetupRequestError && cause.status === 403
          ? { kind: 'denied' }
          : { kind: 'failed', message: describeFailure(cause) });
      });
    return () => controller.abort();
  }, [attempt]);

  if (view.kind === 'done') return <SetupDoneView done={view.done} />;
  const retry = () => {
    setView({ kind: 'loading' });
    setAttempt((count) => count + 1);
  };
  return (
    <AuthCard title="Peach에 오신 것을 환영합니다" lede="미디어 라이브러리를 추가하고 컬렉션을 정리하세요." busy={view.kind === 'loading'}>
      {view.kind === 'denied' ? <Note tone="error">Peach가 실행 중인 이 컴퓨터에서 설정을 여세요.</Note> : null}
      {view.kind === 'failed'
        ? <Note tone="error" action={<Button variant="secondary" onClick={retry}>다시 시도</Button>}>{view.message}</Note>
        : null}
      {view.kind === 'form' ? <>
        <Button variant="secondary" className="self-start" onClick={() => setRestoring((current) => !current)}>
          {restoring ? "초기 설정으로 돌아가기" : "기존 데이터 폴더 사용"}
        </Button>
        {restoring
          ? <SetupRestore onDone={(done) => setView({ kind: 'done', done })} />
          : <SetupForm setup={view.setup} onDone={(done) => setView({ kind: 'done', done })} />}
      </> : null}
    </AuthCard>
  );
}

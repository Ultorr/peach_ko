import { useContext, useState } from 'react';
import { flushSync } from 'react-dom';
import { Heading } from 'react-aria-components';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Label } from '@/components/base/input/label';
import { Select, SelectItem } from '@/components/base/select/select';
import { confirmModal, spinnerHtml } from '@peach/legacy/ui';
import { pageOpens, writeShell } from '@peach/shell';
import { apiSend } from '../../api';
import { ModalFrame } from '../components/modal-frame';
import { Note } from '../components/note';
import { SettingsDialogClose } from '../components/settings-dialog-close';
import { queryClient } from '../query';
import { busyProps, useAction } from '../settings/use-action';
import { ShellActionsContext } from '../router/router';
import { PURPOSES, type FolderPurpose, type FolderRule, type MediaFolder } from './catalog-folders';

interface Preview {
  plan_version: string; total: number; applicable: number; withdrawn: number;
  conflicts: { id: number; name: string; reason: string }[];
  sample: { id: number; name: string }[];
}

export function FolderRuleDialog({ folder, rule, revision, close }: {
  folder: MediaFolder; rule: FolderRule | null; revision: number; close(): void;
}) {
  const actions = useContext(ShellActionsContext);
  const action = useAction();
  const [purpose, setPurpose] = useState<FolderPurpose>(rule?.purpose || 'category');
  const [name, setName] = useState(rule?.name || '');
  const [recursive, setRecursive] = useState(rule?.recursive ?? true);
  const [future, setFuture] = useState(rule?.future ?? false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const body = { folder: folder.id, purpose, name, recursive, future };
  const dirty = () => { setPreview(null); action.setError(''); };
  const finished = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['catalog-folders'] });
    actions?.receipt(message);
    close();
    writeShell({ pageOpens: pageOpens + 1 });
  };
  const showPreview = () => action.run('preview', signal => apiSend<Preview>('/api/folders/preview', body, 'POST', signal), setPreview);
  const save = () => {
    if (!preview) return;
    void action.run('save', signal => apiSend<{ applied: number; conflicts: number }>('/api/folders/rule', {
      ...body, action: 'save', plan_version: preview.plan_version, expected_revision: revision,
    }, 'POST', signal), result => finished(`폴더 용도를 저장했습니다${result.applied ? `, 연결 ${result.applied} 개` : ''}`));
  };
  const remove = async () => {
    flushSync(() => setConfirming(true));
    const result = await confirmModal({
      title: "폴더 규칙 제거", body: `「${folder.name}」의 폴더 규칙을 제거하고 이 규칙으로 만든 연결을 해제합니다.`, confirmLabel: "폴더 규칙 제거",
      onConfirm: () => apiSend('/api/folders/rule', { folder: folder.id, action: 'remove', expected_revision: revision }),
    });
    if (result.confirmed) finished("폴더 규칙을 제거했습니다"); else setConfirming(false);
  };
  const busy = !!action.busy;
  const waiting = (key: string, label: string) => action.busy === key
    ? <><span dangerouslySetInnerHTML={{ __html: spinnerHtml(label) }} />{label}</> : null;
  if (confirming) return null;
  return <ModalFrame isOpen onOpenChange={open => { if (!open && !busy) close() }} width="form" label="폴더 용도 설정">
    <div className="peach-react">
      <div className="flex items-start justify-between gap-4 border-b border-separator-border p-5">
        <div className="min-w-0"><Heading slot="title" className="text-title-2-medium">폴더 용도 설정</Heading>
          <p className="mt-1 text-body-2-regular text-text-secondary wrap-anywhere">{folder.path}</p></div>
        <SettingsDialogClose label="폴더 용도 닫기" onPress={() => { if (!busy) close() }} />
      </div>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-1"><Label>이 폴더의 용도</Label>
          <Select aria-label="이 폴더의 용도" selectedKey={purpose} isDisabled={busy}
            onSelectionChange={key => { setPurpose(key as FolderPurpose); dirty() }}>
            {Object.entries(PURPOSES).map(([key, label]) => <SelectItem key={key} id={key}>{label}</SelectItem>)}
          </Select>
        </div>
        {purpose !== 'category' ? <Input label="연결할 이름" value={name} onChange={value => { setName(value); dirty() }}
          placeholder="인물, 계정 또는 제작사 이름 입력" maxLength={200} isDisabled={busy} isRequired /> : null}
        <Checkbox isSelected={recursive} isDisabled={busy} onChange={value => { setRecursive(value); dirty() }}>하위 폴더에도 적용</Checkbox>
        <Checkbox isSelected={future} isDisabled={busy} onChange={value => { setFuture(value); dirty() }}>새 파일에도 이 규칙 적용</Checkbox>
        {preview ? <section aria-label="폴더 용도 적용 범위" className="flex flex-col gap-3">
          <p className="text-body-medium">{preview.total} 개 항목 · 적용 가능 {preview.applicable} 개{preview.conflicts.length ? ` · 기존 분류 유지 ${preview.conflicts.length} 개` : ''}</p>
          {preview.withdrawn ? <p className="text-body-2-regular text-text-secondary">이 규칙으로 연결된 기존 {preview.withdrawn} 개 항목의 연결을 해제한 뒤 현재 범위에 다시 적용합니다.</p> : null}
          {preview.sample.length ? <ul className="flex flex-col gap-1 text-body-2-regular text-text-secondary">
            {preview.sample.map(item => <li className="wrap-anywhere" key={item.id}>{item.name}</li>)}
          </ul> : null}
          {preview.conflicts.length ? <Note tone="warning" extra={<details className="mt-2 text-body-2-regular"><summary>분류 충돌 보기</summary>
            <ul className="mt-2 flex flex-col gap-2">{preview.conflicts.slice(0, 30).map(item => <li className="wrap-anywhere" key={item.id}>{item.name}：{item.reason}</li>)}</ul>
          </details>}>이미 분류되었거나 개별 확인한 콘텐츠는 유지하며, 나머지 콘텐츠에만 폴더 규칙을 적용합니다.</Note> : null}
        </section> : null}
        {action.error ? <Note tone="error">{action.error}</Note> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-separator-border p-4">
        {rule ? <Button variant="ghost" className="mr-auto" onClick={() => { if (!busy) void remove() }} {...busyProps(action.busy === 'remove')}>규칙 제거</Button> : null}
        <Button variant="secondary" onClick={() => { if (!busy) close() }}>취소</Button>
        {preview ? <Button variant="primary" {...busyProps(action.busy === 'save')} onClick={save}>{waiting('save', "저장 중") || "폴더 용도 저장"}</Button>
          : <Button variant="primary" disabled={purpose !== 'category' && !name.trim()} {...busyProps(action.busy === 'preview')}
            onClick={() => { void showPreview() }}>{waiting('preview', "미리 보는 중") || "적용 결과 미리 보기"}</Button>}
      </div>
    </div>
  </ModalFrame>;
}

import { useEffect, useRef, useState } from 'react';
import { RiArrowDownSLine, RiDatabase2Line, RiGlobalLine, RiHardDrive2Line } from '@remixicon/react';
import { Popover } from 'react-aria-components';
import { Button } from '@/components/base/buttons/button';
import { MENU_ITEM, MENU_ITEM_INTERACTIVE, MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { cx } from '@/utils/cx';
import { formModal, iconSwitchHtml } from '@peach/legacy/ui';
import { MenuDialog } from '../components/menu-dialog';
import { busyProps } from '../settings/use-action';
import type { LibraryProcessingCommand, ProcessingSpeed } from './library-processing';

export const RESOURCE_NOTICE_KEY = 'peach.library-processing.resource-notice.v1';

/** 扫描和已有作品补全共用资料流水线，视频预览由媒体库设置决定。 */
export function ProcessingActions({ busy, scan = false, metadataOnly = false, speedMode = 'standard', onRun }: {
  busy: boolean; scan?: boolean; metadataOnly?: boolean; speedMode?: ProcessingSpeed;
  onRun(command: LibraryProcessingCommand): void | Promise<unknown>;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const prompt = useRef<ReturnType<typeof formModal> | null>(null);
  useEffect(() => () => prompt.current?.close(), []);
  const [open, setOpen] = useState(false);
  const primary: { label: string; icon: typeof RiDatabase2Line; command: LibraryProcessingCommand } = { label: scan ? "미디어 라이브러리 동기화" : "이 영상 동기화", icon: RiDatabase2Line,
    command: scan ? {} : { stage: 'collect' as const } };
  const options: typeof primary[] = [primary,
    ...(scan ? [{ label: "파일만 스캔", icon: RiHardDrive2Line, command: { stage: 'scan' as const } }] : []),
    ...(scan ? [{ label: "라이브러리에 추가된 영상만 동기화", icon: RiDatabase2Line, command: { stage: 'collect' as const } }] : []),
    { label: "동영상 미리보기만 생성", icon: RiHardDrive2Line, command: { stage: 'previews' as const } },
    { label: "정보만 보완", icon: RiGlobalLine, command: { stage: 'metadata' as const } },
  ];
  const run = (command: LibraryProcessingCommand) => {
    if (busy) return;
    setOpen(false);
    let acknowledged = false;
    try { acknowledged = localStorage.getItem(RESOURCE_NOTICE_KEY) === 'seen' } catch { /* 存储不可用时保留提示 */ }
    if (!scan || acknowledged || command.stage === 'metadata') {
      void Promise.resolve(onRun(command)).catch(() => { /* 错误由任务入口留在原位 */ });
      return;
    }
    if (prompt.current) return;
    const previews = command.stage === 'previews';
    const title = previews ? "동영상 미리보기 생성" : command.stage === 'scan' ? "미디어 파일 스캔" : "미디어 라이브러리 동기화";
    const dialog = formModal({
      title,
      description: previews
        ? "동영상 미리보기 생성 시 동영상을 읽고 프로세서를 사용하므로 컴퓨터가 느려질 수 있습니다. 다른 작업과 함께 진행하려면 저부하 모드를 선택하세요."
        : `처리 작업: 미디어 파일 읽기${command.stage === 'scan' ? '' : metadataOnly ? ", 정보 다운로드" : ", 정보 다운로드 및 동영상 미리보기 생성"}. 이 작업으로 컴퓨터가 느려질 수 있습니다. 다른 작업과 함께 진행하려면 저부하 모드를 선택하세요.`,
      body: iconSwitchHtml('processing-speed', "처리 모드", [['low', "저부하"], ['standard', "표준"], ['high', "최대 속도"]], speedMode, { text: true }),
      confirmLabel: title,
      onConfirm: async () => {
        const selected = dialog.dialog.querySelector<HTMLInputElement>('input[name="processing-speed"]:checked')?.value;
        await onRun({ ...command, speed_mode: selected === 'low' ? 'low' : selected === 'high' ? 'high' : 'standard' });
        try { localStorage.setItem(RESOURCE_NOTICE_KEY, 'seen') } catch { /* 本次启动照常完成 */ }
      },
    });
    prompt.current = dialog;
    void dialog.done.then(() => { if (prompt.current === dialog) prompt.current = null });
  };
  return <>
    <span data-button-group data-split-button data-variant="primary">
      <Button leadingIcon={primary.icon} {...busyProps(busy)} onClick={() => run(primary.command)}>{primary.label}</Button>
      <Button ref={trigger} iconOnly leadingIcon={RiArrowDownSLine} aria-label="다른 동기화 방식"
        aria-haspopup="dialog" aria-expanded={open} {...busyProps(busy)} onClick={() => { if (!busy) setOpen(!open) }} />
    </span>
    <Popover triggerRef={trigger} isOpen={open} onOpenChange={setOpen} placement="bottom end" offset={4}
      className={MENU_POPOVER_SURFACE}>
      <MenuDialog aria-label="동기화 방식" className="flex w-56 flex-col gap-1 outline-none">
        {options.map(({ label, icon: Icon, command }) => {
          const blocked = metadataOnly && 'stage' in command && command.stage === 'previews';
          return <button key={label} type="button" disabled={blocked}
            title={blocked ? "먼저 미디어 라이브러리 설정에서 동영상 미리보기 생성을 켜세요" : undefined}
            className={cx(MENU_ITEM, MENU_ITEM_INTERACTIVE, 'text-body-2-medium')}
            onClick={() => run(command)}><Icon aria-hidden className="size-4 shrink-0" />{label}</button>;
        })}
      </MenuDialog>
    </Popover>
  </>;
}

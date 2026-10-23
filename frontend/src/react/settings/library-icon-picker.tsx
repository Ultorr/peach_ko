/* 媒体库图标：触发键显示当前字形，点开是一块七列网格的单选面板，按「应用」才提交。
 *
 * 注册表里没有网格单选的弹出面板，用 React Aria 的 `Popover`、`Dialog`、`RadioGroup` 组合，
 * 面板外观取 BoardUI `menu-styles.ts`。取值是雪碧图里的字形名，服务端按
 * `peach.media_libraries.LIBRARY_ICONS` 校验。 */
import { useRef, useState } from 'react';
import { Dialog, Heading, Popover, Radio, RadioGroup } from 'react-aria-components';
import { MEDIA_SOURCE_ICONS } from '@peach/legacy/ui';

import { Button } from '@/components/base/buttons/button';
import { MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';

import { SourceMark } from './section';

/* 一行七枚、六行排完。第一枚是「不另选」：网盘库自动用网盘标识，本地路径没有可识别的
   来源，就是默认那枚磁盘。其余按题材成组：身体与情欲、身份与装扮、场景与情境、媒介与归档。 */
export const LIBRARY_ICON_CHOICES = [
  ['', "자동 감지"], ['hard-drive', "디스크"], ['database', "자료실"], ['heart', "설렘"], ['heart-hand', "친밀함"], ['flame', "열정"], ['cherry', "체리"],
  ['lollipop', "스위트하트"], ['candy', "사탕"], ['banana', "바나나"], ['droplets', "촉촉함"], ['venus', "여성"], ['mars', "남성"], ['venus-and-mars', "커플"],
  ['gem', "엄선"], ['crown', "여왕"], ['ribbon', "리본"], ['shirt', "제복"], ['graduation-cap', "학생"], ['stethoscope', "간호사"], ['glasses', "안경"],
  ['footprints', "발자국"], ['hand', "손"], ['flower', "꽃"], ['venetian-mask', "역할극"], ['rabbit', "바니걸"], ['paw-print', "동물 귀"], ['dumbbell', "피트니스"],
  ['bed-double', "침실"], ['bath', "욕실"], ['key-round', "비밀"], ['wine', "살짝 취함"], ['cigarette', "담배"], ['moon', "밤"], ['sparkles', "환상"],
  ['camera', "화보"], ['video', "영상"], ['film', "영화"], ['image', "이미지 모음"], ['gamepad-2', "게임"], ['star', "즐겨찾기"], ['tags', "주제"],
] as const;

/** 不另选时的字形与说法：网盘库跟着来源走（115、PikPak 的站标），本地路径没有什么可识别，就是默认磁盘。 */
export function libraryAutoChoice(kind: string): [string, string] {
  const mark = kind !== 'local' ? MEDIA_SOURCE_ICONS[kind] : '';
  return mark ? [mark, "자동 감지"] : ['hard-drive', "기본값"];
}

/** 「不另选」在单选组里的取值。存下来是空串，而空串做单选值时 React Aria 当作没有选中。 */
const AUTO = 'auto';

export function LibraryIconPicker({ value, label, kind = 'local', onChange }: {
  value: string; label: string; kind?: string; onChange(value: string): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [autoMark, autoLabel] = libraryAutoChoice(kind);
  const nameOf = (key: string) => (key && LIBRARY_ICON_CHOICES.find(([choice]) => choice === key)?.[1]) || autoLabel;

  return (
    <>
      <Button ref={trigger} variant="secondary" className="self-start" aria-label={label} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => { setDraft(value); setOpen(true); }}>
        <span data-icon-choice className="flex items-center gap-2"><SourceMark mark={value || autoMark} />{nameOf(value)}</span>
      </Button>
      <Popover triggerRef={trigger} isOpen={open} onOpenChange={setOpen} placement="bottom start" offset={4}
        className={MENU_POPOVER_SURFACE}>
        <Dialog aria-label={`${label}후보`} className="flex w-72 flex-col gap-3 outline-none">
          <Heading slot="title" className="px-1 text-body-medium text-text-primary">미디어 라이브러리 아이콘 선택</Heading>
          {/* 格子里只放图标，名字走 aria-label：带着字的话 42 个候选要排十几行。 */}
          <RadioGroup aria-label="아이콘 후보" value={draft || AUTO} onChange={(next) => setDraft(next === AUTO ? '' : next)}
            className="inline-grid grid-cols-7 gap-1">
            {LIBRARY_ICON_CHOICES.map(([key, name]) => (
              <Radio key={key || AUTO} value={key || AUTO} aria-label={key ? name : autoLabel}
                className="flex h-10 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary outline-none hover:bg-dropdown-item-hover-background focus-visible:ring-2 focus-visible:ring-border-focus-ring data-selected:bg-dropdown-item-hover-background data-selected:text-text-primary">
                <SourceMark mark={key || autoMark} />
              </Radio>
            ))}
          </RadioGroup>
          <div className="flex justify-end gap-2 border-t border-separator-border pt-2.5">
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button disabled={draft === value} onClick={() => { onChange(draft); setOpen(false); }}>적용</Button>
          </div>
        </Dialog>
      </Popover>
    </>
  );
}

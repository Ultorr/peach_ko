/* 添加 JAV 订阅：输入女优名，到 JavDB 搜她的演员卡，勾选后登记到她名下并订上（ADR-0083）。
 *
 * 查找只是列出候选、不写任何东西：同名的人站上可能不止一位，替用户决定「就是这个」是错的。
 * 名字对得上、又只有一个人的那几张先勾上，其余的要用户自己点。地址仍由服务端按勾选的 id 拼，
 * 页面从头到尾不送地址。这位在账本里不存在也可以订：服务端会新建她。 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { RiSearchLine } from '@remixicon/react';

import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';

import { cardClass } from '../components/card';
import { Note } from '../components/note';
import { ExternalLink, FieldLabel, Help } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import { followFeedByName, lookupFeedActor, type FeedCandidate, type FeedLookup } from './follow-manage';

const PLACEHOLDER = "배우 이름을 입력해 JavDB에서 배우 페이지를 찾으세요";

export interface AddFeedProps {
  readOnly: boolean;
  toast(message: string): void;
  /** 订上之后让清单重取。 */
  onAdded(): void;
}

/** 勾下去会登记到谁名下：先看勾选的卡已经在谁名下，再看账本里按名字认得出谁，都没有就新建。 */
function destination(result: FeedLookup, picked: ReadonlySet<string>): { text: string; blocked: boolean } {
  const holders = new Map<number, string>();
  for (const card of result.candidates) {
    if (picked.has(card.id) && card.held_by) holders.set(card.held_by.id, card.held_by.name);
  }
  if (holders.size > 1) {
    return { text: `선택한 카드가 원장에서 서로 다른 인물에 속합니다：${[...holders.values()].join('、')}. 먼저 병합한 후 구독하세요`, blocked: true };
  }
  const [holder] = holders.values();
  if (holder) return { text: `「${holder}」 명의로 등록됩니다`, blocked: false };
  if (result.known) return { text: `원장의 「${result.known.name}」 명의로 등록됩니다`, blocked: false };
  return { text: `원장에 「${result.q}」이(가) 없어 새 인물을 만듭니다`, blocked: false };
}

function CandidateRow({ card, picked, onPick }: { card: FeedCandidate; picked: boolean; onPick(on: boolean): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Checkbox isSelected={picked} onChange={onPick}>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 break-words">{card.names.join('、')}</span>
          {card.record ? <Chip variant="caption" color="neutral">{card.record}</Chip> : null}
          {card.held_by ? (
            <small className="text-caption-1-regular text-text-secondary">{`이미 「${card.held_by.name}」 명의로 등록됨`}</small>
          ) : null}
        </span>
      </Checkbox>
      <ExternalLink href={card.url}>{card.id}</ExternalLink>
    </div>
  );
}

export function AddFeed({ readOnly, toast, onAdded }: AddFeedProps) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<FeedLookup | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set<string>());
  const action = useAction();

  const search = () => {
    const q = name.trim();
    if (!q || readOnly) return;
    void action.run('lookup', (signal) => lookupFeedActor(q, signal), (found) => {
      setResult(found);
      setPicked(new Set(found.suggested));
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); search() }
  };
  const close = () => { setResult(null); setPicked(new Set()); action.setError('') };
  const add = () => {
    if (!result) return;
    void action.run('follow', (signal) => followFeedByName(result.q, [...picked], signal), (done) => {
      toast(done.created
        ? `「${done.entity_name}」을(를) 새로 등록하고 새 항목을 구독했습니다`
        : `「${done.entity_name}」의 새 항목을 구독했습니다`);
      setName('');
      close();
      onAdded();
    });
  };

  const where = result ? destination(result, picked) : null;

  return (
    /* 和「添加关注」那一块同一个形：一张填充卡，标题在卡里。 */
    <div className={cardClass({ padding: 'none', className: 'flex flex-col gap-4 px-6 py-5 max-sm:px-4' })}>
      <h3 className="text-title-2-medium text-text-primary">JAV 구독 추가</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 grow">
          <Input aria-label="배우 이름" placeholder={PLACEHOLDER} value={name} leadingIcon={RiSearchLine}
            enterKeyHint="search" isDisabled={readOnly} onChange={setName} onKeyDown={onKeyDown} />
        </div>
        <Button variant="primary" disabled={readOnly || !name.trim()} {...busyProps(action.busy === 'lookup')}
          onClick={search}>찾기</Button>
      </div>

      {action.error ? <Note tone="error" title="이번 작업을 완료하지 못했습니다">{action.error}</Note> : null}

      {result ? (
        <div className="flex flex-col gap-3">
          <FieldLabel>JavDB 배우 카드</FieldLabel>
          {result.candidates.length ? result.candidates.map((card) => (
            <CandidateRow key={card.id} card={card} picked={picked.has(card.id)}
              onPick={(on) => setPicked((now) => {
                const next = new Set(now);
                if (on) next.add(card.id); else next.delete(card.id);
                return next;
              })} />
          )) : <Help>JavDB에서 이 이름을 찾지 못했습니다.</Help>}
          {result.candidates.length ? (
            <Help role="status">{picked.size ? where!.text : "해당 배우의 카드를 선택하세요. 모자이크판과 무수정판 기록이 같은 배우라면 둘 다 선택하세요."}</Help>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {result.candidates.length ? (
              <Button variant="primary" size="small" disabled={readOnly || !picked.size || where!.blocked}
                {...busyProps(action.busy === 'follow')} onClick={add}>{`구독 추가（${picked.size}）`}</Button>
            ) : null}
            <Button variant="secondary" size="small" onClick={close}>닫기</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

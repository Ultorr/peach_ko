/* 元数据字段那一类卡片的正文：一组互斥的来源值，加上还没收录的 genre。
 *
 * 一张候选卡上下两段读的是两件事：上段是这个来源给的那个值，也就是选中它就会写进账本
 * 的东西；下段是同一来源顺带交回来的其它字段，只作判断依据。两段各自铺底色并由一条线
 * 隔开，选哪一段能改账本就不用猜。 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Radio, RadioGroup } from 'react-aria-components';

import { Button } from '@/components/base/buttons/button';
import { InputBase, TextField } from '@/components/base/input/input';
import { errorMessage } from '../../api';
import type { ReviewCandidate, ReviewRow } from './review';
import { pendingGenres, recordGenre, reloadReview } from './review';

/** 候选顺带交回来的那些字段在界面上叫什么。表里没有的按原名显示。 */
const EVIDENCE_LABELS: Record<string, string> = {
  title: "제목", original_title: "원제", runtime: "출처 재생 시간", director: "감독",
  label: 'Label', poster_url: "포스터", cover_url: "표지", screenshot_urls: "스크린샷",
  trailer_url: "예고편",
};

/** 收录 genre 时的候选词表，一份挂在整页上：每张卡各写一遍的话，同一百来个 option 会在
 *  DOM 里重复几十份。 */
export const GENRE_TAGS_ID = 'reviewgenretags';

export function GenreTagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <datalist id={GENRE_TAGS_ID}>
      {tags.map((tag) => <option key={tag} value={tag} />)}
    </datalist>
  );
}

/** 一个来源给的值，加上它顺带交回来的判断依据。 */
function CandidateBody(
  { candidate, selectable = false }: { candidate: ReviewCandidate; selectable?: boolean },
) {
  const evidence = Object.entries(candidate.catalog_evidence || {})
    .filter(([, item]) => item && item.display_value);
  const id = candidate.content_id || candidate.provider_id;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="relative flex min-w-0 flex-col gap-0.5 px-4 py-3 group-hover:bg-background-primary-hover group-data-selected:bg-background-primary-hover">
        <b className="text-body-2-medium text-text-secondary">
          {candidate.source}
          {candidate.official ? " · 공식 출처 우선" : ''}
          {id ? ` · ID ${id}` : ''}
        </b>
        <span className="text-body-medium break-words text-text-primary">
          {candidate.display_value || ''}
        </span>
        {(candidate.warnings || []).map((warning) => (
          <i key={warning} className="text-body-2-regular text-status-yellow-text">{warning}</i>
        ))}
        {selectable ? (
          <span aria-hidden="true" data-candidate-choice
            className="absolute top-4 right-4 inline-grid size-4 place-items-center rounded-full border border-border-checkbox-default bg-background-primary-default group-hover:border-border-checkbox-hover group-data-selected:border-border-focus-ring group-data-selected:bg-accent-600">
            <span className="size-1.5 rounded-full bg-text-white opacity-0 group-data-selected:opacity-100" />
          </span>
        ) : null}
      </span>
      {evidence.length ? (
        <dl className="flex flex-col gap-1 border-t border-separator-border bg-background-primary-default px-4 py-2.5">
          {evidence.map(([field, item]) => (
            <div key={field} className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-body-2-regular text-text-secondary">
                {EVIDENCE_LABELS[field] || field}
              </dt>
              <dd className="min-w-0 text-body-2-regular break-words text-text-primary">
                {item.display_value}
              </dd>
              {(item.warnings || []).map((warning) => (
                <small key={warning} className="w-full text-caption-1-regular text-status-yellow-text">
                  {warning}
                </small>
              ))}
            </div>
          ))}
        </dl>
      ) : null}
    </span>
  );
}

/** 互斥的几个来源值。只有一个候选时没什么可选的：单选圈只会让人以为还有别的选项，
 *  所以改成纯展示，而提交仍按这一个候选走。 */
export function CandidateChoices(
  { row, fieldName, value, onChange, locked }: {
    row: ReviewRow;
    fieldName: string;
    value: string;
    onChange(candidateKey: string): void;
    locked: boolean;
  },
) {
  const candidates = row.candidates || [];
  if (!candidates.length) return null;
  if (candidates.length === 1) {
    return (
      <div className="flex overflow-hidden rounded-surface border border-separator-border bg-background-secondary-default">
        <CandidateBody candidate={candidates[0]!} />
      </div>
    );
  }
  return (
    <RadioGroup aria-label={`${fieldName || "후보"}의 출처`} value={value} isDisabled={locked}
      onChange={onChange} className="flex flex-col gap-2">
      {candidates.map((candidate) => (
        <Radio key={candidate.candidate_key} value={candidate.candidate_key}
          className="group flex cursor-pointer items-center gap-2 overflow-hidden rounded-surface border border-separator-border bg-background-secondary-default outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring data-selected:border-border-button-active data-disabled:cursor-not-allowed">
          <CandidateBody candidate={candidate} selectable />
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** 一个还没收录的 genre。给中文名就是收录成那个标签，判「不是内容」就是永久排除。 */
function GenreRow(
  { genre, tags, locked, toast }: {
    genre: string; tags: string[]; locked: boolean; toast(message: string): void;
  },
) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const record = useMutation({
    mutationFn: (tag: string) => recordGenre(genre, tag),
    onSuccess: async (result, tag) => {
      if (!result.ok) { setProblem(result.error || "서버가 이번 등록을 거부했습니다"); return }
      toast(tag ? `「${genre}」 등록 태그: 「${tag}」` : `「${genre}」: 콘텐츠와 무관한 태그로 판정되었습니다`);
      await reloadReview();
    },
    onError: (cause) => setProblem(errorMessage(cause)),
  });
  const accept = () => {
    const tag = draft.trim();
    if (!tag) { setProblem("먼저 중국어 태그를 입력하세요"); return }
    setProblem('');
    record.mutate(tag);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <b lang="ja" className="text-body-medium text-text-primary">{genre}</b>
      <TextField aria-label={`「${genre}」의 등록용 중국어 태그`} value={draft} onChange={setDraft}
        maxLength={40} isDisabled={locked || record.isPending} className="min-w-40 flex-1">
        {/* 输入法还在组词时的那一下 Enter 是「选这个词」，不是「提交」。 */}
        <InputBase size="small" list={tags.length ? GENRE_TAGS_ID : undefined}
          autoComplete="off" placeholder="중국어 태그"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            accept();
          }} />
      </TextField>
      {/* 两个结论都是次级键：这张卡上的主动作是「通过」，把词收进表里只是让那一步有得
          可选。收录挂上 primary 的话，同一张卡上会有两个蓝底键在抢「按这里」。 */}
      <Button variant="secondary" size="small" disabled={locked || record.isPending}
        onClick={accept}>등록</Button>
      <Button variant="secondary" size="small" disabled={locked || record.isPending}
        onClick={() => { setProblem(''); record.mutate('') }}>콘텐츠와 무관함</Button>
      {problem
        ? <p role="status" className="w-full text-body-2-regular text-text-error-primary">{problem}</p>
        : null}
    </div>
  );
}

/** 未收录 genre 是这张卡上唯一一件不判候选的事：来源给了值，Peach 还没决定它算哪个标签，
 *  于是那句「来源还有 2 个未收录 genre」每批都原样再来一次。收录一次是对整张词表说的，
 *  不属于其中某一个来源，所以单列一块摆在候选下面。 */
export function PendingGenres(
  { row, tags, locked, toast }: {
    row: ReviewRow; tags: string[]; locked: boolean; toast(message: string): void;
  },
) {
  const genres = pendingGenres(row);
  if (!genres.length) return null;
  return (
    <div role="group" aria-label="미등록 장르" className="flex flex-col gap-2 rounded-surface border border-separator-border bg-background-primary-default px-4 py-3">
      <h5 className="text-body-2-medium text-text-secondary">{`미등록 장르 · ${genres.length}`}</h5>
      {genres.map((genre) => (
        <GenreRow key={genre} genre={genre} tags={tags} locked={locked} toast={toast} />
      ))}
    </div>
  );
}

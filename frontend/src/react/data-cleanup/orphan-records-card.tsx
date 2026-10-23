/* 数据管理页上的「孤儿记录」：文件已不在盘上、带着个人记录的作品（ADR-0087）。
 *
 * 每行一条已消失的作品：快照图供认片，后面是它带的记录、在库里可能是它新版本的文件。
 * 选一个文件接过去，记录搬到那个文件上、旧行删掉，整批可按批次号撤回；彻底删除连记录一起
 * 删，过危险档确认弹层。没有已消失的作品时整块不出现。 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { confirmModal } from '@peach/legacy/ui';
import { LOC } from '@peach/legacy/core';

import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';

import { errorMessage } from '../../api';
import { DataTable, type DataColumn } from '../components/data-table';
import { Fieldset, FieldsetTitle } from '../components/fieldset';
import { Note } from '../components/note';
import { spriteGlyph } from '../components/sprite-glyph';
import { queryClient } from '../query';
import { busyProps } from '../settings/use-action';
import {
  attachOrphan, candidateText, fetchOrphanRecords, ORPHAN_RECORDS_KEY, purgeOrphan, recordsText,
  type OrphanRecord,
} from './orphan-records';

const PLAY = spriteGlyph('play');

const refresh = () => queryClient.invalidateQueries({ queryKey: ORPHAN_RECORDS_KEY, exact: true });

function OrphanActions({ item, toast }: { item: OrphanRecord; toast(message: string): void }) {
  const [target, setTarget] = useState<number | null>(item.candidates[0]?.id ?? null);
  const attach = useMutation({
    mutationFn: () => attachOrphan(item.id, Number(target)),
    onSuccess: (data) => { toast(`기록을 새 파일에 연결했습니다. 작업 묶음 ${data.batch}`); void refresh(); },
    onError: (error) => toast(errorMessage(error)),
  });
  const purge = useMutation({
    mutationFn: () => purgeOrphan(item.id),
    onSuccess: (data) => {
      toast(data.blocked.length
        ? `${item.name} 파일이 디스크에 다시 존재해 삭제하지 않았습니다. 다음 스캔 시 라이브러리에 다시 연결합니다`
        : `영구 삭제됨 ${item.name}`);
      void refresh();
    },
  });
  const remove = () => {
    void confirmModal({
      title: "영구 삭제",
      body: `삭제 대상:「${item.name}」 항목과 연결된 기록(${recordsText(item.records)}). 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "영구 삭제",
      danger: true,
      onConfirm: () => purge.mutateAsync(),
    });
  };
  const busy = attach.isPending || purge.isPending;
  return (
    <span className="flex min-w-48 flex-wrap items-center gap-2">
        {item.candidates.length
          ? <Select aria-label={`항목 ${item.name} 기록을 연결할 파일 선택`} className="w-52" selectedKey={target}
              onSelectionChange={(key) => { if (key !== null) setTarget(Number(key)) }}>
              {item.candidates.map((candidate) => (
                <SelectItem key={candidate.id} id={candidate.id} textValue={candidateText(candidate)}>
                  {candidateText(candidate)}
                </SelectItem>
              ))}
            </Select>
          : <span className="text-text-secondary">품번이나 파일 이름이 일치하는 파일이 없습니다</span>}
        {item.candidates.length
          ? <Button size="small" disabled={target === null} {...busyProps(busy)}
              onClick={() => attach.mutate()}>이 파일에 연결</Button>
          : null}
        <Button variant="danger" size="small" {...busyProps(busy)} onClick={remove}>영구 삭제</Button>
    </span>
  );
}

function OrphanIdentity({ item }: { item: OrphanRecord }) {
  return (
        <span className="flex min-w-0 items-center gap-3">
          {/* 快照图供认片；没有图或取不到时留一格带描边的占位，和重复文件页的封面格同一个样子。
              窄屏收起，把宽度让给名字与记录。 */}
          <span className="relative inline-grid aspect-16/10 w-24 flex-none place-items-center max-cleanup-tight:hidden overflow-hidden rounded-lg border border-separator-border bg-background-tertiary-default text-text-tertiary">
            <PLAY aria-hidden className="size-5" />
            {item.has_thumb
              ? <img src={`/thumb?id=${item.id}&c=4`} alt="" loading="lazy"
                  onError={(event) => event.currentTarget.remove()}
                  className="absolute inset-0 size-full object-contain" />
              : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span title={item.name} className="max-w-56 truncate text-body-regular text-text-primary">{item.name}</span>
            <small className="max-w-56 truncate text-caption-1-regular text-text-secondary">
              {[item.code, LOC[item.location] || item.location].filter(Boolean).join(' · ')}
            </small>
          </span>
        </span>
  );
}

export function OrphanRecordsCard({ toast }: { toast(message: string): void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const query = useQuery({ queryKey: ORPHAN_RECORDS_KEY, queryFn: ({ signal }) => fetchOrphanRecords(signal) });
  const items = query.data?.items ?? [];
  const purge = useMutation({
    mutationFn: (ids: number[]) => purgeOrphan(ids),
    onSuccess: (data) => {
      toast(`영구 삭제됨 ${data.purged} 개 기록${data.blocked.length ? `，${data.blocked.length} 개 파일이 복원되어 삭제하지 않았습니다` : ''}`);
      setSelected([]); void refresh();
    },
  });
  const removeSelected = (chosen: OrphanRecord[]) => void confirmModal({
    title: "선택한 기록 영구 삭제",
    body: `아래 ${chosen.length} 개 항목과 연결된 모든 기록을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
    items: chosen.map((item) => item.name),
    confirmLabel: "선택한 기록 영구 삭제", danger: true,
    onConfirm: () => purge.mutateAsync(chosen.map((item) => item.id)),
  });
  const columns: DataColumn<OrphanRecord>[] = [
    { id: 'item', label: "항목", value: (item) => item.name, render: (item) => <OrphanIdentity item={item} /> },
    { id: 'records', label: "연결된 기록", value: (item) => recordsText(item.records),
      render: (item) => <span className="block min-w-28">{recordsText(item.records) || "개인 기록 없음"}</span> },
    { id: 'target', label: "연결 및 작업", value: (item) => item.candidates.length,
      render: (item) => <OrphanActions item={item} toast={toast} /> },
  ];
  if (!query.isError && !items.length) return null;
  return (
    <section id="orphan-records" aria-labelledby="orphan-records-title" className="flex scroll-mt-20 flex-col gap-4">
        {query.isError
          ? <Fieldset layout="stack" labelledBy="orphan-records-title">
              <FieldsetTitle id="orphan-records-title">연결되지 않은 기록</FieldsetTitle>
              <Note tone="error" title="연결되지 않은 기록을 읽지 못했습니다">{errorMessage(query.error)}</Note>
            </Fieldset>
          : <DataTable label="파일이 사라진 항목" items={items} columns={columns}
              title="연결되지 않은 기록" titleId="orphan-records-title" unit="개 항목"
              description="이 항목들의 파일은 디스크에 없지만 좋아요, 나중에 보기, 재생목록, 시청 기록은 남아 있습니다. 새 파일에 연결하면 기록을 옮기고 기존 항목은 삭제합니다."
              rowId={(item) => String(item.id)} rowLabel={(item) => item.name}
              selected={selected} onSelected={setSelected}
              actions={(chosen) => <Button variant="danger" size="small" disabled={!chosen.length}
                {...busyProps(purge.isPending)} onClick={() => removeSelected(chosen)}>
                {`선택한 기록 영구 삭제(${chosen.length}）`}
              </Button>} />}
    </section>
  );
}

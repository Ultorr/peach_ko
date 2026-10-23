import { useState } from 'react';
import { RiFileListLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { LinkButton } from '@/components/base/buttons/link-button';
import { fmtDur, fmtSize, LOC } from '@peach/legacy/core';
import { DataTable, type DataColumn } from '../components/data-table';
import { EmptyState } from '../components/empty-state';
import { Note } from '../components/note';
import { Disclosure, Stack } from '../settings/section';
import { busyProps, useAction } from '../settings/use-action';
import type { LibraryGroup, LibraryItem } from './diagnostics';

const identity = (item: LibraryItem) => item.title || item.name || item.code || `항목 #${item.id}`;
const listText = (items: LibraryItem[]) => [
  ["항목", "품번", "파일 이름", "미디어 라이브러리", "경로", "길이(초)", "크기(바이트)"],
  ...items.map(item => [identity(item), item.code ?? '', item.name, LOC[item.location] || item.location,
    item.path, item.duration ?? '', item.size ?? '']),
].map(row => row.map(value => String(value ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');

export function HealthList({ group, openItem, receipt }: {
  group: LibraryGroup; openItem(id: number): void; receipt(message: string): void;
}) {
  const action = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const copy = (items: LibraryItem[]) => void action.run('copy',
    () => navigator.clipboard.writeText(listText(items)), () => receipt("목록을 복사했습니다"));
  const columns: DataColumn<LibraryItem>[] = [
    { id: 'title', label: "항목", value: identity, render: item => <span className="flex min-w-48 max-w-72 flex-col gap-1">
      <LinkButton variant="primary" className="justify-start whitespace-normal text-left"
        onClick={() => openItem(item.id)}>{identity(item)}</LinkButton>
      {item.name && item.name !== identity(item)
        ? <span data-middle-truncate title={item.name} className="block min-w-0 text-caption-1-regular text-text-secondary">{item.name}</span> : null}
    </span> },
    { id: 'code', label: "품번", value: item => item.code || '',
      render: item => <span className="whitespace-nowrap">{item.code || "식별되지 않음"}</span> },
    { id: 'location', label: "미디어 라이브러리", value: item => LOC[item.location] || item.location,
      render: item => LOC[item.location] || item.location || "가져오지 못함" },
    { id: 'path', label: "파일 경로", value: item => item.path,
      render: item => <span data-middle-truncate title={item.path}
        className="block w-64 text-body-2-regular text-text-secondary">{item.path || "가져오지 못함"}</span> },
    { id: 'duration', label: "재생 시간", value: item => item.duration ?? 0,
      render: item => item.duration && item.duration > 0 ? fmtDur(item.duration) : "가져오지 못함" },
    { id: 'size', label: "크기", value: item => item.size ?? 0,
      render: item => item.size !== null ? fmtSize(item.size) : "가져오지 못함" },
  ];
  return <Disclosure summary={`${group.label} · ${group.count === null ? "가져오지 못함" : `${group.count.toLocaleString()} 개`}`}>
    {group.count === null ? <Note tone="neutral">목록을 가져오지 못했습니다. 다시 확인하세요.</Note> : !group.items.length
      ? <EmptyState icon={RiFileListLine} title="목록이 비어 있음" shell="plain">처리할 항목이 없습니다.</EmptyState>
      : <Stack>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {group.truncated ? <span className="text-body-2-regular text-text-secondary">
            불러옴 {group.items.length.toLocaleString()} / {group.count.toLocaleString()} 개 항목
          </span> : null}
          <Button size="small" variant="secondary" {...busyProps(action.busy === 'copy')}
            onClick={() => copy(group.items)}>현재 목록 복사</Button>
        </div>
        {action.error ? <Note tone="error">{action.error}</Note> : null}
        <DataTable label={group.label} title="항목 목록" unit="개 항목" panel={false}
          items={group.items} columns={columns} rowId={item => String(item.id)} rowLabel={identity}
          selected={selected} onSelected={setSelected}
          actions={items => <Button size="small" variant="secondary" {...busyProps(action.busy === 'copy')}
            onClick={() => copy(items)}>선택 항목 복사</Button>} />
      </Stack>}
  </Disclosure>;
}

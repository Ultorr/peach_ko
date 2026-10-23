import { useContext, useDeferredValue, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useLocation } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Key, Selection } from 'react-aria-components';
import { RiFolder3Line, RiFolderOpenLine, RiFolderSettingsLine, RiSearchLine, RiSideBarLine } from '@remixicon/react';
import { Breadcrumb, BreadcrumbItem } from '@/components/base/breadcrumb/breadcrumb';
import { TreeView, TreeViewItem } from '@/components/base/tree-view/tree-view';
import { Button } from '@/components/base/buttons/button';
import { IconButton } from '@/components/base/buttons/icon-button';
import { Input } from '@/components/base/input/input';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { isCatalogPath } from '@peach/legacy/core';
import { errorMessage } from '../../api';
import { ModalFrame } from '../components/modal-frame';
import { SettingsDialogClose } from '../components/settings-dialog-close';
import { Note } from '../components/note';
import { EmptyState } from '../components/empty-state';
import { useOverlayScrollbar } from '../components/overlay-scrollbar';
import { ShellActionsContext } from '../router/router';
import { FolderRuleDialog } from './folder-rule-dialog';
import { useFolderStickyOffset } from './use-folder-sticky-offset';
import { folderHref, folderQuery, PURPOSES, type FolderPage, type FolderScope, type MediaFolder } from './catalog-folders';

export function FolderBrowseToggle() {
  return useInRouterContext() ? <FolderBrowseControl /> : null;
}

function FolderBrowseControl() {
  const address = useLocation();
  const actions = useContext(ShellActionsContext);
  if (!isCatalogPath(address.pathname)) return null;
  const params = new URLSearchParams(address.search);
  const active = params.get('browse') === 'folders' || !!params.get('folder');
  return <IconButton size="small" data-folder-mode-toggle="" aria-label="폴더 모드" title="폴더 모드" aria-pressed={active}
    icon={RiFolder3Line}
    onClick={() => actions?.navigate(folderHref(address,
      active ? { browse: null, folder: null, folder_recursive: null } : { browse: 'folders' }))} />;
}

export function CatalogFolders() {
  const address = useLocation();
  const actions = useContext(ShellActionsContext);
  const params = new URLSearchParams(address.search);
  const active = params.get('browse') === 'folders' || !!params.get('folder');
  const scope: FolderScope = { loc: params.get('loc') ?? '', library: params.get('library') ?? '' };
  useFolderStickyOffset(active);
  const key = params.get('folder') || '';
  const query = useQuery({ ...folderQuery(scope, key), enabled: active });
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState(false);
  const treeHost = document.getElementById('catalogFoldersTree');
  const headerHost = document.getElementById('catalogFolderHeader');
  useLayoutEffect(() => {
    if (treeHost) treeHost.hidden = !active;
    if (headerHost) headerHost.hidden = !active;
    document.body.toggleAttribute('data-folder-browse', active);
    return () => {
      if (treeHost) treeHost.hidden = true;
      if (headerHost) headerHost.hidden = true;
      document.body.removeAttribute('data-folder-browse');
    };
  }, [active, treeHost, headerHost]);
  useEffect(() => { setDrawer(false); setEditing(false) }, [key, active]);
  if (!active || !treeHost || !headerHost || !actions) return null;
  const go = (id: string) => {
    setDrawer(false);
    actions.navigate(folderHref(address, { browse: 'folders', folder: id }));
  };
  const data = query.data;
  const navigation = <FolderTree scope={scope} selected={key} current={data} go={go} />;
  return <>
    {createPortal(<div className="min-w-0">{navigation}</div>, treeHost)}
    {createPortal(<div className="catalog-folder-heading">
      <div className="flex min-w-0 items-center gap-2">
        <span className="folder-drawer-trigger"><IconButton aria-label="폴더 트리 열기" icon={RiSideBarLine} size="small"
          onClick={() => setDrawer(true)} /></span>
        <Breadcrumb aria-label="폴더 경로">
          <BreadcrumbItem current={!key} onClick={() => go('')} icon={RiFolder3Line}>모든 폴더</BreadcrumbItem>
          {data?.ancestors.map((node, index) => <BreadcrumbItem key={node.id} current={index === data.ancestors.length - 1}
            onClick={() => go(node.id)}><span className="folder-crumb-name" data-middle-truncate="">{node.name}</span></BreadcrumbItem>)}
        </Breadcrumb>
        {data?.selected ? <IconButton aria-label="폴더 용도 설정" icon={RiFolderSettingsLine} size="small"
          onClick={() => setEditing(true)} /> : null}
      </div>
      {query.error ? <Note tone="error" action={<Button variant="secondary" size="small" onClick={() => { void query.refetch() }}>다시 시도</Button>}>{errorMessage(query.error)}</Note> : null}
      {data?.conflicts?.length ? <Note tone="warning" action={<Button variant="secondary" size="small" onClick={() => setEditing(true)}>분류 충돌 보기</Button>}>{data.conflicts.length} 개 항목의 기존 분류 유지</Note> : null}
      {data?.selected ? <div className="folder-scope-row">
        <Checkbox size="sm" isSelected={params.get('folder_recursive') !== '0'}
          onChange={on => actions.navigate(folderHref(address, { folder_recursive: on ? null : '0' }))}>하위 폴더 포함</Checkbox>
        <span className="text-caption-1-regular text-text-tertiary">{data.rule ? `${PURPOSES[data.rule.purpose]}${data.rule.name ? ` · ${data.rule.name}` : ''}` : "개인 분류"}</span>
      </div> : null}
      {query.isPending ? <div data-skeleton="" aria-busy="true" aria-label="폴더를 읽는 중" className="h-8 w-full rounded-md skeleton-sheen" /> : null}
      {data?.children.length ? <div className="folder-children" aria-label="하위 폴더">{data.children.map(node =>
        <Button key={node.id} variant="secondary" size="small" leadingIcon={RiFolder3Line}
          onClick={() => go(node.id)}><span className="truncate">{node.name}</span></Button>)}</div> : null}
    </div>, headerHost)}
    <ModalFrame isOpen={drawer} onOpenChange={setDrawer} width="form" label="폴더 트리">
      <div className="flex items-center justify-between border-b border-separator-border p-4">
        <h2 className="text-title-2-medium">폴더</h2><SettingsDialogClose label="폴더 트리 닫기" onPress={() => setDrawer(false)} />
      </div>
      <div className="peach-react relative p-4">{drawer ? navigation : null}</div>
    </ModalFrame>
    {editing && data?.selected ? <FolderRuleDialog key={data.selected.id} folder={data.selected} rule={data.rule}
      revision={data.rules_revision} close={() => setEditing(false)} /> : null}
  </>;
}

function FolderTree({ scope, selected, current, go }: {
  scope: FolderScope; selected: string; current: FolderPage | undefined; go(id: string): void;
}) {
  const roots = useQuery(folderQuery(scope));
  const [expanded, setExpanded] = useState<Set<Key>>(new Set());
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const searchQuery = useQuery({ ...folderQuery(scope, '', deferredSearch), enabled: !!deferredSearch.trim() });
  const scroll = useOverlayScrollbar<HTMLDivElement>();
  useEffect(() => {
    if (current?.ancestors.length) setExpanded(previous => new Set([...previous, ...current.ancestors.filter(row => row.has_children).map(row => row.id)]));
  }, [current?.ancestors]);
  const keys = [...expanded].map(String);
  const branches = useQueries({ queries: keys.map(id => folderQuery(scope, id)) });
  const childMap = new Map<string, MediaFolder[]>();
  branches.forEach((branch, index) => { if (branch.data) childMap.set(keys[index], branch.data.children) });
  if (current?.selected) childMap.set(current.selected.id, current.children);
  const render = (node: MediaFolder) => {
    const loaded = childMap.get(node.id);
    return <TreeViewItem key={node.id} id={node.id} label={node.name} icon={RiFolder3Line} expandedIcon={RiFolderOpenLine}
      trailingContent={node.parent ? undefined : node.location === 'local' ? "로컬" : node.location}>
      {node.has_children ? loaded ? loaded.map(render)
        : <TreeViewItem id={`${node.id}:loading`} label="폴더를 읽는 중" isDisabled /> : null}
    </TreeViewItem>;
  };
  const choose = (selection: Selection) => {
    if (selection !== 'all') { const id = selection.values().next().value; if (id && !String(id).endsWith(':loading')) go(String(id)); }
  };
  const failed = roots.error || branches.find(branch => branch.error)?.error;
  return <section aria-label="폴더 탐색" className="flex min-w-0 flex-col gap-3">
    <Input aria-label="폴더 찾기" placeholder="폴더 찾기" leadingIcon={RiSearchLine} value={search}
      onChange={setSearch} size="small" />
    {failed ? <Note tone="error" action={<Button variant="secondary" size="small" onClick={() => { void roots.refetch(); branches.forEach(branch => { if (branch.error) void branch.refetch() }) }}>다시 시도</Button>}>{errorMessage(failed)}</Note> : null}
    <div className="relative"><div ref={scroll} className="folder-tree-scroller">
      {roots.isPending ? <div data-skeleton="" aria-busy="true" aria-label="폴더 트리를 읽는 중" className="h-60 w-full rounded-xl skeleton-sheen" />
        : deferredSearch ? <div className="flex flex-col gap-1">{searchQuery.isPending ? <div data-skeleton="" aria-busy="true" className="h-8 skeleton-sheen" aria-label="폴더를 찾는 중" />
          : searchQuery.error ? <Note tone="error">{errorMessage(searchQuery.error)}</Note>
          : searchQuery.data?.matches.length ? searchQuery.data.matches.map(node => <Button key={node.id} variant="secondary" size="small" leadingIcon={RiFolder3Line}
            onClick={() => { setSearch(''); go(node.id) }}>{node.name}</Button>) : <EmptyState shell="plain" icon={RiSearchLine} title="일치하는 폴더 없음">다른 폴더 이름으로 검색해 보세요.</EmptyState>}</div>
        : <TreeView aria-label="미디어 폴더" size="sm" expandedKeys={expanded} onExpandedChange={setExpanded}
          selectedKeys={new Set(selected ? [selected] : [])} onSelectionChange={choose}
          renderEmptyState={() => <EmptyState shell="plain" icon={RiFolder3Line} title="추가된 미디어 폴더 없음">미디어 라이브러리 설정에서 폴더를 추가하고 스캔하세요.</EmptyState>}>
          {roots.data?.roots.map(render)}
        </TreeView>}
    </div></div>
  </section>;
}

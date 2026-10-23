/** 应用导航的完整词表；默认可见顺序由 sidebar 的持久偏好决定。 */
export type SidebarKey = '' | 'performers' | 'studios' | 'tags' | 'jav' | 'flagged' | 'playlists'
  | 'follow' | 'immerse' | 'manage' | 'stats' | 'taste' | 'review' | 'data-cleanup' | 'trash'
  | 'follow-manage' | 'quality' | 'activity';
export type ManagementKey = 'stats' | 'taste' | 'review' | 'cleanup' | 'trash' | 'follow'
  | 'quality' | 'activity' | 'configuration';
export type NavigationItem<Key extends string = string> = readonly [key: Key, label: string, glyph: string];

export const SIDEBAR_ITEMS = [
  ['', "홈", 'home'],
  ['performers', "아티스트", 'user-round'],
  ['studios', "스튜디오", 'clapperboard'],
  ['tags', "태그", 'tags'],
  ['jav', 'JAV', 'jav'],
  ['flagged', "표시한 항목", 'bookmark'],
  ['playlists', "재생목록", 'playlist'],
  ['follow', "팔로우", 'rss'],
  ['immerse', "몰입 모드", 'gallery-vertical-end'],
  ['manage', "관리", 'wrench'],
] as const satisfies readonly NavigationItem<SidebarKey>[];

export const MANAGE_SECTIONS = [
  ['stats', "통계", 'chart'],
  ['taste', "취향", 'heart'],
  ['review', "수동 검토", 'square-check-big'],
  ['cleanup', "데이터 관리", 'hard-drive'],
  ['trash', "휴지통", 'trash'],
  ['follow', "팔로우 관리", 'rss'],
  ['quality', "고화질 버전", 'sparkles'],
  ['activity', "작업 센터", 'history'],
  ['configuration', "Peach 설정", 'folder-cog'],
] as const satisfies readonly NavigationItem<ManagementKey>[];

export const MANAGE_MENU_SECTIONS: readonly ManagementKey[] = ['stats', 'taste', 'cleanup', 'follow', 'activity', 'configuration'];
export const getManageMenuSections = (configurable: boolean): readonly NavigationItem<ManagementKey>[] =>
  MANAGE_SECTIONS.filter(([key]) => MANAGE_MENU_SECTIONS.includes(key) && (key !== 'configuration' || configurable));

export const OPTIONAL_SIDEBAR_ITEMS: readonly NavigationItem<SidebarKey>[] = MANAGE_SECTIONS
  .flatMap(([key, label, glyph]): NavigationItem<SidebarKey>[] => key === 'configuration' ? []
    : [[key === 'follow' ? 'follow-manage' : key === 'cleanup' ? 'data-cleanup' : key, label, glyph]]);
export const NAV_CATALOG: readonly NavigationItem<SidebarKey>[] = [...SIDEBAR_ITEMS, ...OPTIONAL_SIDEBAR_ITEMS];
export const DIRECT_MANAGE_NAV: Readonly<Partial<Record<SidebarKey, ManagementKey>>> = {
  stats: 'stats', review: 'review', 'data-cleanup': 'cleanup', trash: 'trash',
  'follow-manage': 'follow', quality: 'quality', activity: 'activity',
};

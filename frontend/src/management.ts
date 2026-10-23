import { icon } from '@peach/legacy/core';

import { islandButton, islandGlyph, islandSelect } from './island-skeleton';

/* 「扫描与采集」「媒体修复」两张卡的正文。卡片本体由 React 画，骨架与遗留层的取数占位
   画的是同一段话：写两份的话，骨架上的那句会比真卡短一截，接管时整张卡跳一次。 */
export const SCAN_CARD_TEXT = "파일과 영상 정보를 동기화하고 설정에 따라 로컬 동영상 미리보기를 만듭니다. 메뉴에서 파일 스캔, 등록 영상 동기화, 미리보기 생성, 정보 보완을 선택할 수 있습니다.";
export const REPAIR_CARD_TEXT = "타임스탬프 표가 없어 끊기거나 인덱스가 없어 열리지 않는 MP4를 복구합니다. 자주 보는 영상부터 복구합니다.";

const bar = '<span class="skeleton skeleton-text" aria-hidden="true"></span>';
/* 要等数据才能执行的键是真的按不了：原生 `disabled` 挡住点击与聚焦，`data-skeleton-action`
   让各档按键在骨架里统一成同一副禁用面（`board.css`），尺寸仍是最终那一档，数据一到只换颜色。 */
const waiting = 'type="button" disabled data-skeleton-action';

/* 两张 React 卡的骨架包在同一层 `.peach-react` 里，按键与下拉照 Board UI 的尺寸画（见
   `island-skeleton.ts`）。卡片这一层的结构照 React 那两张卡抄：外面一列 `gap-4`，标题与正文
   同一对字级。下拉框里只是一截占位条，不是控件，留 `aria-disabled` 就够。 */
const waitingAction = 'disabled data-skeleton-action';
const unavailable = 'aria-disabled="true"';
const island = (card: string) => `<div class="peach-react"><div class="flex flex-col gap-4">${card}</div></div>`;
const cardText = (title: string, text: string) => `<div data-geist-fieldset-content>
          <h3 class="text-title-2-medium text-text-primary">${title}</h3>
          <p class="text-body-2-regular text-text-secondary">${text}</p></div>`;

/** 「扫描与采集」卡：与 React `LibraryProcessingCard` 同一副容器、同一段正文、同一组键。
 *  「复核资料」只在有候选时出现，这里不预画。 */
export function scanCardSkeletonHtml(): string {
  return island(`<section aria-label="스캔 및 수집" data-geist-fieldset data-cleanup-task data-cleanup-processing data-fieldset-stack>
        ${cardText("스캔 및 수집", SCAN_CARD_TEXT)}
        <footer data-geist-fieldset-footer><a href="/sources" class="inline-flex items-center justify-center gap-1 whitespace-nowrap font-sans rounded-sm text-body-medium text-accent-600"><span>소스 및 인증 정보</span>${islandGlyph('arrow-up', 'size-[18px] shrink-0 rotate-90')}</a><span data-button-group data-split-button data-variant="primary">${islandButton({ glyph: 'database', label: "미디어 라이브러리 동기화", attrs: waitingAction })}${islandButton({ glyph: 'chevron-down', attrs: `${waitingAction} aria-label="다른 동기화 방식"` })}</span></footer>
      </section>`);
}

/** 「媒体修复」卡：页脚的媒体库下拉框先按最终尺寸画出来，库名要等数据；「开始修复」要等选定
 *  媒体库，骨架里是禁用态。 */
export function repairCardSkeletonHtml(): string {
  return island(`<section aria-label="미디어 복구" data-geist-fieldset data-cleanup-task data-cleanup-processing>
        ${cardText("미디어 복구", REPAIR_CARD_TEXT)}
        <footer data-geist-fieldset-footer>${islandSelect(bar, { className: 'w-48', attrs: unavailable })}${islandButton({ label: "복구 시작", attrs: waitingAction })}</footer>
      </section>`);
}

/** 首屏复用读数卡、三张任务卡、链接管理与资源同步的最终容器；静态标题、正文和键立即呈现。 */
export function cleanupSkeletonHtml(): string {
  const stats = [["수동 검토", 'square-check-big'], ["고화질 버전", 'sparkles'], ["중복 파일", 'file-stack'], ["불필요한 파일", 'file-archive'], ["휴지통", 'trash']];
  const presets = `<span class="geist-button ui-organize-preset-skeleton">${bar}</span>`.repeat(3);
  const organizeField = (label: string) => `<div class="ui-organizefield"><span>${label}</span>
            <span class="geist-input ui-organize-input-skeleton">${bar}</span></div>`;
  return `<div class="ui-cleanuppage" data-skeleton="cleanup" aria-busy="true" aria-label="데이터 관리 상태 불러오는 중">
    <div class="ui-cleanupstats">${stats.map(([title, glyph]) => `
      <button type="button" class="board-plain-stat" disabled>
        <span class="ui-board-plain-stat-head"><span class="ui-board-stat-tile">${icon(glyph!)}</span>${title}</span>
        <strong>${bar}</strong><span class="cleanupmeta">${bar}</span></button>`).join('')}</div>
    <div class="cleanupgrid">
      <div class="cleanupscraping">${scanCardSkeletonHtml()}</div>
      <div class="cleanupmediarepair">${repairCardSkeletonHtml()}</div>
      <section class="cleanupfieldset cleanuporganize" data-geist-fieldset data-cleanup-task aria-labelledby="cleanup-loading-organize">
        <div class="geist-fieldset-content"><h3 class="geist-fieldset-title" id="cleanup-loading-organize">정리</h3>
          <p>템플릿에 따라 파일 이름을 바꾸고 폴더에 정리합니다. 미리보기로 확인한 뒤 실행하세요. 실행한 작업은 일괄 되돌릴 수 있습니다.</p>
          <div class="ui-organizefields">
            <div class="organizesource"><span class="ui-gselect"><span class="gselectfield organize-source-skeleton">${bar}${icon('chevron-down')}</span></span></div>
            ${organizeField("파일 이름 템플릿")}
            ${organizeField("폴더 템플릿")}
            <div class="ui-organizepresets">${presets}</div>
            <p class="cleanupmeta">${bar}</p>
          </div></div>
        <footer class="geist-fieldset-footer" data-geist-fieldset-footer><button class="geist-button primary" ${waiting}>미리보기</button></footer>
      </section></div>
    <section class="ui-resourcesync" aria-labelledby="cleanup-loading-links">
      <h2 id="cleanup-loading-links">링크 관리</h2>
      <div class="resourcesyncbox" data-geist-fieldset data-cleanup-task data-fieldset-stack>
        <div class="resourcesyncbody geist-fieldset-content"><h3 class="geist-fieldset-title">외부 링크</h3>
          <div class="linksummary"><div class="ui-linkstats"><div><span>전체 링크 수</span><b>${bar}</b><small>${bar}</small></div>${["공식 사이트/소속사", "소셜 계정", "항목 정보 사이트"].map(title => `<div><span>${title}</span><b>${bar}</b></div>`).join('')}</div>
          <div class="ui-linkhosts"><span>주요 사이트</span><b>${bar}</b></div></div></div>
        <div class="resourcesyncfooter geist-fieldset-footer" data-geist-fieldset-footer><button class="resourceaction primary" ${waiting}>${icon('unlink')}<span>끊어진 링크 확인</span></button></div>
      </div></section>
    <section class="ui-resourcesync" aria-labelledby="cleanup-loading-sync">
      <h2 id="cleanup-loading-sync">리소스 동기화</h2>
      <div class="resourcesyncbox" data-geist-fieldset data-cleanup-task>
        <div class="resourcesyncbody geist-fieldset-content"><h3 class="geist-fieldset-title">파일 및 기록 대조</h3>
          <p>컬렉션 기록을 기준으로 로컬 디스크와 클라우드의 파일을 확인하고, 파일이 사라진 기록과 빈 폴더, 더 이상 참조되지 않는 캐시를 표시합니다.</p></div>
        <div class="resourcesyncfooter geist-fieldset-footer" data-geist-fieldset-footer><button class="resourceaction primary" ${waiting}>${icon('git-compare')}<span>파일 확인</span></button></div>
      </div></section></div>`;
}

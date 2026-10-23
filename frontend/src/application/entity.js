import { createRevealSourceAction } from './source-action';
import { emptyEntityFilters, parseEntityFilters, entityFilterSearch, parseMediaView, entityViewSearch } from '../react/entity-page/entity-route';
import { photoViewActive as hasPhotoView } from '../react/entity-page/photo-surface';
import { createEntityApplication } from '../react/entity-page/entity-application';
import { waitEntityShapes } from './loading.js';
/* entity 域控制器：本域状态与动作，启动由 Application 的生命周期统一安装。 */
import { catalogGridLayout, catalogSkeletonHtml, catalogState, comboItems, commitContextFilter, toggleTag } from './catalog.js';
import { nextSortState, sortDirWord } from './../sort-preferences';
import { barsContext, notifyShell, selectMode, selected, state, writeShell } from './../shell/index';
import { $, ENTITY_ROUTES, api, esc, icon } from '../core';
import { managedEntry, releaseManagedRoute, updateManagedRoute } from './../history/managed';
import { javActive, scheduleStickySurfaces, setJavLayout, sortOptions } from './layout.js';
import { navigationState, openRoutedPage } from './navigation.js';
import { releaseHoverPreviews } from './../card-art/hover';
import { preferencesState, wireDrag } from './preferences.js';
import { fitSkeleton, formModal, indexSkeletonHtml, wireHorizontalScroller } from '../ui-kit';
import { feedRowHtml, feedState, loadEntityShapes, wireFeedNewRow } from './feed.js';
import { receiptsState } from './receipts.js';
import { JAV_LAYOUTS, PHOTO_LAYOUTS, javLayout, photoLayout, photoSize, storePhotoLayout, storePhotoSize } from './../appearance/layout';
import { dropBars } from './../catalog-bars';
import { indexState, openFollowAuthorFromIndex } from './index.js';
import { followState, pushFollowFeed } from './follow.js';
import { applyDensity, paintPhotoSizeButton } from './../appearance/density';
import { applicationEffects } from './effects';
import { entitySkeletonHtml } from './../entity-skeleton';
import { INDEX_TITLES } from './../index-skeleton';
import { filterControlsSkeletonHtml } from './../filter-controls-skeleton';
import { cardRatio, gridLayout } from './../appearance/layout';
import { pageSkeletonHtml } from './../management-placeholder';
import { islandShortcutsEntry } from './../island-skeleton';
export const entityState = { ENTITY_FILTER_KEYS: undefined, emptyEntityFilters: undefined, parseEntityFilters: undefined, entityFilterSearch: undefined, cloneBarsContext: undefined, activeFilterState: undefined, entityPageView: undefined, entityPageWall: undefined, entityPageRevision: undefined, entityPageCurrent: undefined, entityPageLive: undefined, EMPTY_ENTITY_MEDIA: undefined, parseMediaView: undefined, entityViewSearch: undefined, entityBodyCanLoadMore: undefined, entityBodySkeleton: undefined, entityPageHelpers: undefined, entityFollowActions: undefined, SOURCE_HINTS: undefined, sourceHint: undefined, syncedText: undefined, sourceToolButtons: undefined, application: undefined };

export function entityPageEntry(){
  const entry=managedEntry($('#index'));
  return entry&&entry.path.endsWith('/*')&&entry.host.isConnected?entry:null;
}

export function pushEntityPage(patch){if(entityState.entityPageCurrent())updateManagedRoute($('#index'),patch)}

export function currentBarsContext(){
  if(barsContext.type==='item')return barsContext;
  const entry=entityPageEntry();
  if(entry){const {kind,name,filters}=entry.props;return {type:'entity',kind,name,filters:{...filters}}}
  return barsContext;
}

export function sortKeys(current,dir,jav=javActive()){
  return sortOptions(jav).map(([key,label])=>{
    const pressed=current===key,next=nextSortState(key,current,dir);
    return {key,label,pressed,dir:pressed&&sortDirWord(key,dir)?(dir==='asc'?'asc':'desc'):'',
      ariaLabel:next?`${label}${next.dir?sortDirWord(next.sort,next.dir):''} 기준 정렬`:''}});
}

export function routeEntityPage(kind,name,filters,media=entityState.EMPTY_ENTITY_MEDIA,options={}){
  return entityState.application.route(kind,name,filters,media,options);
}

export function entityPageActions(kind,name){return entityState.application.actions(kind,name)}

export function entityPageProps(kind,name,filters,media){return entityState.application.props(kind,name,filters,media)}

export function photoViewActive(){return hasPhotoView({entityWall:entityState.entityPageWall,
    entityCurrent:entityState.entityPageCurrent(),indexVisible:!$('#index').hidden,pathname:location.pathname,
    followMedia:followState.followMediaView,statsVisible:!$('#stats').hidden},
    ()=>[...document.querySelectorAll('.followphotowall')].some(wall=>wall.getClientRects().length>0))}

export function syncPhotoWalls(){entityState.photos.sync()}

export function syncDensityControl(){
  if(photoViewActive())paintPhotoSizeButton(photoSize());else applyDensity();
}

export function setPhotoSize(value){entityState.photos.setSize(value)}

export const revealSource = createRevealSourceAction({
  request:id=>api('/api/reveal',{method:'POST',body:JSON.stringify({id})}),
  success:()=>receiptsState.toast({text:"파일 탐색기에 표시했습니다"}),
  failureText:error=>entityState.sourceHint(error instanceof Error?error.message:String(error)),
});

export async function revealForIsland(id){const status={textContent:''};await revealSource(id,status);return status.textContent}

export async function syncForIsland(id){
  const status={textContent:''};let removed=[];
  await syncMissing(id,status,result=>{if(result.items)removed=result.items.map(item=>item.id)});
  return {text:status.textContent,removed};
}

export async function syncMissing(id,status,done){
  status.textContent="폴더 대조 중…";
  try{
    const r=await api('/api/purge-missing',{method:'POST',body:JSON.stringify({id})});
    if(r.ok===false){status.textContent=entityState.sourceHint(r.error);return}
    status.textContent=r.removed
      ? `${entityState.syncedText(r)}(대조: ${r.checked} 개${r.unreadable?`，${r.unreadable}개 읽기 실패`:''}）`
      : r.unreadable
        ? `폴더의 ${r.unreadable}개를 읽을 수 없어 변경하지 않았습니다`
        : `폴더의 ${r.checked}개가 모두 있어 변경할 필요가 없습니다`;
    if(r.removed){
      const ids=(r.items||[]).filter(item=>item.disposal!=='reattached').map(item=>item.id);
      if(done)done(r);
      receiptsState.actionReceipt(entityState.syncedText(r),{undo:ids.length?async()=>{
        await api('/api/batch',{method:'POST',body:JSON.stringify({ids,operation:'restore'})});
        if(done)done({removed:0,restored:ids.length});
      }:null});
    }else receiptsState.actionReceipt("폴더 대조 완료, 변경 사항 없음");
  }catch(e){status.textContent=entityState.sourceHint(e.message);receiptsState.actionFailure("폴더 대조",e)}
}

export function sourceTools(id){return `<div class="srctools">${entityState.sourceToolButtons(id)}
    <span class="srcstate" aria-live="polite"></span></div>`}

export function wireSourceTools(root,done){
  const status=root.querySelector('.srcstate');
  if(!status)return;
  const reveal=root.querySelector('[data-reveal]');
  const sync=root.querySelector('[data-sync]');
  if(reveal)applicationEffects.handler(reveal, 'onclick', ()=>revealSource(Number(reveal.dataset.reveal),status,{button:reveal}));
  if(sync)applicationEffects.handler(sync, 'onclick', ()=>syncMissing(Number(sync.dataset.sync),status,done));
}

export async function entityAliasForm(mine,write){
  const form=formModal({
    title:"별칭 추가",
    description:"이미지는 이름별로 저장됩니다. 다른 표기를 추가하면 후보 이미지가 늘어나며, 추가한 이름을 대표 이름으로 지정할 수도 있습니다.",
    body:`<label class="modalfield"><span>별칭</span>
        <input class="geist-input" name="alias" maxlength="80" autocomplete="off"
          placeholder="다른 표기 또는 예명"></label>`
      +(mine.length?`<div class="modalfield"><span>직접 추가한 별칭</span>
        <div class="aliaschips">${mine.map(one=>`<span class="aliaschip">${esc(one)}
          <button type="button" data-alias-drop="${esc(one)}"
            aria-label="별칭 취소 ${esc(one)}">${icon('x')}</button></span>`).join('')}</div></div>`:''),
    confirmLabel:"별칭 추가",
    confirmDisabled:true,
    onConfirm:()=>write({alias:field.value.trim()})});
  const field=form.dialog.querySelector('[name=alias]');
  applicationEffects.handler(field, 'oninput', ()=>{form.confirmButton.disabled=!field.value.trim()});
  /* 撤销只认自己添的那几个：刮削和合并留下的别名是这条实体当初被认成这个人的依据，
     一次点击删不得。服务端按来源守这条线，这里只列它报回来的那几个。 */
  form.dialog.querySelectorAll('[data-alias-drop]').forEach(chip=>applicationEffects.handler(chip, 'onclick', async()=>{
    const gone=chip.dataset.aliasDrop;
    form.close();
    try{await write({alias:gone,remove:true})}
    catch(error){receiptsState.actionFailure("별칭 취소",error);return}
    receiptsState.actionReceipt(`취소한 별칭: ${gone}`,{undo:async()=>{await write({alias:gone})}});
  }));
  const {confirmed,result}=await form.done;
  if(!confirmed)return;
  if(result?.added)receiptsState.actionReceipt(`추가한 별칭: ${result.alias}`,{undo:async()=>{
    await write({alias:result.alias,remove:true})}});
  else receiptsState.actionReceipt(`${result?.alias}은(는) 이미 이 항목의 이름입니다`);
}

export function showEntityLoading(kind,name){
  const jav=['performer','studio'].includes(kind)&&feedState.hasEntityPart(kind,name,'jav');
  const head=`<div data-filter-row="bottom" class="flex min-w-0 items-center gap-3 px-3 py-2 min-h-12"><h3 data-entity-readout><span data-skeleton="count" class="relative inline-block h-3.5 w-24 rounded-md align-middle skeleton-sheen"></span></h3>${islandShortcutsEntry()}${kind==='agency'?'':filterControlsSkeletonHtml(sortKeys(state.sort,state.dir,jav),jav?{name:'jav-layout',label:"JAV 카드 형식",value:javLayout(),options:JAV_LAYOUTS}:null)}</div>`;
  const top=kind==='agency'?'':`<div data-entity-media><button type="button" data-media-view="videos" aria-label="동영상" aria-pressed="true" disabled data-skeleton-action>${icon('play')}</button><button type="button" data-media-view="photos" aria-label="사진" disabled data-skeleton-action>${icon('pics')}</button></div><span data-entity-sep></span><div data-entity-scroll><div data-entity-states>${catalogState.catalogViews().map(view=>`<button type="button" data-entity-state="${esc(view.k)}" aria-pressed="${state.state===view.k}" disabled data-skeleton-action>${esc(view.label)}</button>`).join('')}</div>`;
  const body=kind==='agency'
    ?indexSkeletonHtml({kind:'performers',layout:indexState.peopleIndexLayout()})
    :pageSkeletonHtml("항목을 불러오는 중",{cards:true,className:'catalog-skeleton postercard-skeleton',cardRatio:cardRatio(gridLayout({active:jav,home:false,portrait:false}))});
  const placeholder=entitySkeletonHtml(kind,head,body,top);
  if($('#index').firstElementChild?.dataset.skeleton!==`entity/${kind}`){
    $('#index').innerHTML=placeholder;
    syncEntitySkeletonParts(kind,name);
    fitSkeleton($('#index'));
  }else syncEntitySkeletonParts(kind,name);
}

export function syncEntitySkeletonParts(kind,name){
  const skeleton=$('#index').firstElementChild;
  if(skeleton?.dataset.skeleton!==`entity/${kind}`)return;
  const sync=(present,wanted,insert)=>{if(wanted&&!present)insert();else if(!wanted&&present)present.remove()};
  sync(skeleton.querySelector('.entityfoot'),kind!=='agency'&&feedState.hasEntityPart(kind,name,'costars'),
    ()=>skeleton.querySelector('.entityhero')?.insertAdjacentHTML('beforeend',feedState.costarSkeletonFoot()));
  sync(skeleton.querySelector('.feednew'),feedState.hasEntityPart(kind,name,'feed'),
    ()=>skeleton.querySelector('.entitysection')?.insertAdjacentHTML('beforebegin',feedState.feedNewSkeletonSection()));
  sync(skeleton.querySelector('.entityfacts'),kind==='performer'&&feedState.hasEntityPart(kind,name,'facts'),
    ()=>skeleton.querySelector('.entityprofile')?.insertAdjacentHTML('beforeend',feedState.factsSkeleton()));
}

export function showEntityMissing(kind){
  const index=ENTITY_ROUTES[kind]||kind,title=INDEX_TITLES[index]||"항목";
  const actions=INDEX_TITLES[index]?`<a class="geist-button primary" href="/${index}">${title} 목록으로 돌아가기</a>`:'';
  $('#index').innerHTML=preferencesState.emptyState('search-x',`찾을 수 없는 항목: ${title}`,"이름이 잘못되었거나 다른 이름으로 병합되었을 수 있습니다. 목록에서 다시 찾아보세요.",{actions});
}

export function openEntity(kind,name){openRoutedPage(entityState.application.fresh(kind,name))}

export function installEntity9() {
entityState.ENTITY_FILTER_KEYS = ['loc','creator','tag','state','dur_min','dur_max','orient','sort','dir'];
entityState.emptyEntityFilters = emptyEntityFilters;
entityState.parseEntityFilters = search=>parseEntityFilters(search,{sort:preferencesState.appSettings.defaultSort,dir:preferencesState.appSettings.defaultSortDirection});
entityState.entityFilterSearch = entityFilterSearch;
entityState.cloneBarsContext = context=>context&&context.type==='entity'
  ? {...context,filters:{...context.filters}}:context;
entityState.activeFilterState = ()=>{const context=currentBarsContext();return context.type==='home'?state:context.filters};
$('#q').value=state.q;
catalogState.rememberSearchValue();
}

export function installEntity17() {
entityState.entityPageView = '';
entityState.entityPageWall = false;
entityState.entityPageRevision = 0;
entityState.entityPageCurrent = ()=>!!entityPageEntry();
entityState.entityPageLive = (kind,name)=>{const entry=entityPageEntry();
  return !!entry&&!$('#index').hidden&&entry.props.kind===kind&&entry.props.name===name};
entityState.EMPTY_ENTITY_MEDIA = {media:'videos',set:0};
entityState.parseMediaView = parseMediaView;
entityState.entityViewSearch = entityViewSearch;
entityState.entityBodyCanLoadMore = ()=>!$('#index').hidden&&$('#stats').hidden;
entityState.entityBodySkeleton = ()=>catalogSkeletonHtml();
entityState.entityPageHelpers = {
  wireDrag:row=>{if(row)wireDrag(row)},
  wireScroller:row=>{if(row)wireHorizontalScroller(row)},
  wireFeedRow:row=>wireFeedNewRow(row),
  feedRowHtml,
  receipt:(message,options)=>receiptsState.actionReceipt(message,options),
  failure:(label,error)=>receiptsState.actionFailure(label,error),
  aliasForm:(mine,write)=>entityAliasForm(mine,write),
  sourceToolsHtml:id=>sourceTools(id),
  wireSourceTools:(root,done)=>wireSourceTools(root,done),
  comboItems:filters=>comboItems(filters),
  sortKeys:(sort,dir,jav)=>sortKeys(sort,dir,jav),
};
entityState.entityFollowActions = {...followState.followFeedActions,
  route:()=>{},shuffle:()=>{},loaded:()=>{},toggleSelection:()=>{}};
entityState.SOURCE_HINTS = {
  'source offline':"소스가 오프라인이어서 대조하지 않았습니다. 소스를 연결한 후 다시 시도하세요",
  'source not mapped':"이 기기에 소스 드라이브 문자가 매핑되지 않았습니다",
  'file missing':"원본 파일이 디스크에 없습니다. 오른쪽 동기화를 눌러 원장에 반영하세요",
  'unsupported platform':"현재 서버 운영체제에서는 파일 위치 열기를 지원하지 않습니다",
  'reveal failed':"파일 탐색기를 열지 못했습니다. 다시 시도하세요.",
};
entityState.sourceHint = message=>entityState.SOURCE_HINTS[message]||message;
entityState.syncedText = r=>[r.trashed?`총 ${r.trashed} 개 항목을 휴지통으로 이동했습니다`:'',
  r.vanished?`${r.vanished}개는 개인 기록이 있어 사라짐으로 표시했습니다`:'',
  r.reattached?`${r.reattached}개의 기록을 라이브러리의 다른 버전에 연결했습니다`:''].filter(Boolean).join('，');
entityState.sourceToolButtons = id=>`
    <button type="button" data-reveal="${id}" title="파일 탐색기에서 원본 파일 폴더 열기"
      aria-label="원본 파일 위치">${icon('folder-open')}</button>
    <button type="button" data-sync="${id}" title="폴더 대조: 디스크에서 삭제된 항목은 Peach 휴지통으로 이동하고 개인 기록이 있으면 사라짐으로 표시"
      aria-label="삭제 동기화">${icon('folder-sync')}</button>`;
}

export function connectPhotoController(){
  entityState.application=createEntityApplication({
    controller:{
      context:()=>{const context=currentBarsContext();return context.type==='entity'?context:null},
      live:(kind,name)=>entityState.entityPageLive(kind,name),current:()=>entityState.entityPageCurrent(),
      route:(path,replace=false)=>navigationState.route(path,replace),suffix:()=>location.search+location.hash,
      restoreHomeContext:()=>writeShell({barsContext:{type:'home',filters:state}}),
      releaseBodyPreviews:()=>releaseHoverPreviews($('#index [data-entity-body]')),push:pushEntityPage,
      state:()=>({seed:String(state.seed||''),jav:state.jav==='1'}),
      preferences:()=>({revision:entityState.entityPageRevision,feedRevision:feedState.feedRevision,
        photoSize:photoSize(),photoLayout:photoLayout(),photoLayouts:PHOTO_LAYOUTS,
        followImagesOnly:!!preferencesState.appSettings.followImagesOnly,
        javLayout:javLayout(),javLayouts:JAV_LAYOUTS,states:catalogState.VIEW_PILLS,peopleLayout:indexState.peopleIndexLayout(),
        layout:catalogGridLayout(),selectMode,selected:new Set(selected),seekSeconds:preferencesState.appSettings.seekSeconds,
        groupCollapse:preferencesState.appSettings.groupCollapse,wireDrag,skeletonHtml:entityState.entityBodySkeleton,
        canLoadMore:entityState.entityBodyCanLoadMore,
        follow:{helpers:followState.followFeedHelpers,actions:entityState.entityFollowActions}}),
      changeFilter:commitContextFilter,rollSeed:()=>receiptsState.rollSeed(),
      writeSeed:seed=>{state.seed=seed;notifyShell()},
      setJavLayout,javLayout,setPhotoLayout:storePhotoLayout,syncPhotoWalls,openEntity,photoViewActive,
      recordPainted:(view,wall)=>{entityState.entityPageView=view;entityState.entityPageWall=wall},
      syncDensity:syncDensityControl,scheduleSticky:scheduleStickySurfaces,
      releasePage:()=>releaseManagedRoute($('#index')),showMissing:showEntityMissing,dropBars,
    },
    loading:{
      shapesReady:(kind,name)=>feedState.hasEntityShape(kind,name),waitShapes:waitEntityShapes,paintSkeleton:showEntityLoading,
      resetView:()=>{writeShell({detailReturnBarsContext:null});entityState.entityPageView='';entityState.entityPageWall=false},
      loadShapes:loadEntityShapes,syncParts:syncEntitySkeletonParts,
    },
    photos:{
      preferences:()=>({size:photoSize(),layout:photoLayout(),imagesOnly:!!preferencesState.appSettings.followImagesOnly}),
      walls:()=>document.querySelectorAll('.followphotowall'),pushEntity:pushEntityPage,pushFollow:pushFollowFeed,
      syncDensity:syncDensityControl,storeSize:storePhotoSize,
    },
    helpers:entityState.entityPageHelpers,
    actions:{toggleTag,openFollowAuthor:openFollowAuthorFromIndex,javContext:on=>writeShell({entityJavLayout:!!on})},
    sortPreference:()=>({sort:preferencesState.appSettings.defaultSort,dir:preferencesState.appSettings.defaultSortDirection}),
  });
  entityState.photos=entityState.application.photos;
  entityState.entityPageHelpers=entityState.application.helpers;
}

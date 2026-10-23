import { selectionSurface, selectionDock, setSelectionMode, toggleSelection as toggleSelected } from '../react/catalog-grid/selection-controller';
import { selectSurface } from '../shell';
/* selection 域控制器：本域状态与动作，启动由 Application 的生命周期统一安装。 */
import { loadCatalog, pushGridPage } from './catalog.js';
import { followLastSelectedId, followSelected, lastSelectedId, pageOpens, selectMode, selected, state, writeShell } from './../shell/index';
import { photoViewActive, pushEntityPage, setPhotoSize } from './entity.js';
import { pushFollowFeed } from './follow.js';
import { batchDockApi, loadBatchDock } from '../react/application-residents';
import { censorOn, preferencesState } from './preferences.js';
import { configureHoverPreview, releaseHoverPreviews } from './../card-art/hover';
import { $, api } from '../core';
import { loadingState } from './loading.js';
import { applicationEffects } from './effects';
import { confirmModal, formModal, setActionBusy } from '../ui-kit';
import { reloadAfterWrite } from './layout.js';
import { receiptsState } from './receipts.js';
import { photoSize } from './../appearance/layout';
import { applyDensity, toggleDensity } from './../appearance/density';
import { installCardArt, refitNativeImages, upgradeCover } from './../card-art/framing';
export const selectionState = { batchDockProps: undefined, trashCount: undefined, currentSelectSurface: undefined, REGION_CHOICES: undefined, BATCH_RUNNERS: undefined, coverRecheck: undefined };

export function paintSelection(){
  // 卡片网格、垃圾队列与关注页的选中态归 React：每次推一份新的集合，卡片按引用比较才看得出变了。
  pushGridPage({selected:new Set(selected),selectMode});
  pushEntityPage({selected:new Set(selected),selectMode});
  pushFollowFeed({selected:new Set(followSelected),selectMode});
  /* 底部浮条归常驻面 `batch-dock`（`react/batch-dock/`）：壳推计数与语境，每种语境列哪几颗键由它按语境定。 */
  selectionState.batchDockProps=selectionDockProps();
  /* 浮条宿主在 `#main` 外面，玻璃贴图的观察器看不到它长出来，画完补扫一遍。 */
  if(batchDockApi()){batchDockApi().render(selectionState.batchDockProps);preferencesState.syncGlassOptics()}
}

export function setSelectMode(on,clear=false) {
    writeShell(setSelectionMode({selected,followSelected},selectionSnapshot(),selectionSurface(location.pathname),!!on,clear));
    document.body.classList.toggle('select-mode',selectMode);
    if(selectMode)releaseHoverPreviews();
    $('#selectMode').setAttribute('aria-pressed',String(selectMode));paintSelection();
  }

export function visibleCardIds(){return [...loadingState.gridCards()].map(card=>+card.dataset.id)}

export function toggleSelection(id,range=false) {
    writeShell(toggleSelected({selected,followSelected},selectionSnapshot(),selectionSurface(location.pathname),visibleCardIds(),id,range));
    setSelectMode(true);
  }

export function visibleFollowIds(){return [...document.querySelectorAll('[data-follow-list] > [data-follow-item]')]
  .map(card=>+card.dataset.followItem)}

export function toggleFollowSelection(id,range=false) {
    writeShell(toggleSelected({selected,followSelected},selectionSnapshot(),'follow',visibleFollowIds(),id,range));
    setSelectMode(true);
  }

export async function runCatalogBatch(operation,button){
  const labels={like:"좋아요",seen:"본 항목으로 표시",later:"나중에 보기에 추가",dispose:"휴지통으로 이동",restore:"복원",delete:"영구 삭제"};
  const titles={like:"선택한 항목 좋아요",seen:"시청 완료로 표시",later:"나중에 보기에 추가",dispose:"휴지통으로 이동",restore:"선택한 항목 복원",delete:"선택한 항목 영구 삭제"};
  const ids=[...selected];if(!ids.length)return;
  return confirmModal({title:titles[operation],body:`선택한 항목 ${ids.length}개를 처리합니다.${operation==='delete'?"파일과 컬렉션 기록을 영구 삭제합니다. 복구할 수 없습니다.":operation==='dispose'?"컬렉션 기록은 휴지통에서 복원할 수 있습니다.":''}`,confirmLabel:titles[operation],danger:operation==='delete',onConfirm:async()=>{
  setActionBusy(button);
  try{const r=await api('/api/batch',{method:'POST',body:JSON.stringify({ids,operation})});
    if(r.blocked&&r.blocked.length)throw new Error(`영구 삭제 완료: ${r.purged}개; ${r.blocked.length}개는 삭제하지 못해 휴지통에 남아 있습니다:
`
      +r.blocked.slice(0,5).map(x=>`${x.path}（${x.reason}）`).join('\n'));
    setSelectMode(false,true);await reloadAfterWrite();
    const inverse=operation==='dispose'?'restore':operation==='restore'?'dispose':null;
    receiptsState.actionReceipt(`완료: ${labels[operation]} ${ids.length} 개`,{undo:inverse?async()=>{
      if(inverse==='dispose'&&r.restored_reasons){
        for(const reason of [null,'manual','junk','duplicate','missing']){
          const group=ids.filter(id=>r.restored_reasons[id]===reason);
          if(group.length)await api('/api/batch',{method:'POST',body:JSON.stringify({ids:group,operation:inverse,disposal_reason:reason})});
        }
      }else await api('/api/batch',{method:'POST',body:JSON.stringify({ids,operation:inverse})});
      await reloadAfterWrite();
    }:null})}
  catch(error){setActionBusy(button,false);throw error}
  finally{setActionBusy(button,false);paintSelection()}
  }});
}

export async function pickBatchRegion(){
  const ids=[...selected];if(!ids.length)return;
  const modal=formModal({
    title:"제작 국가 판별",
    description:`선택한 항목 ${ids.length}개를 같은 제작 국가로 지정합니다. 지정 후에는 메타데이터 수집이나 자동 추정으로 제작 국가가 변경되지 않습니다.`,
    body:`<div class="chips" role="group" aria-label="제작 국가">`+selectionState.REGION_CHOICES.map(([key,label])=>
      `<button type="button" class="chip" aria-pressed="false" data-region-pick="${key}">
        <span class="chip-label">${label}</span></button>`).join('')+`</div>`,
    confirmLabel:"제작 국가 판별",
    confirmDisabled:true,
    onConfirm:async()=>{
      const picked=modal.dialog.querySelector('[data-region-pick][aria-pressed="true"]');
      if(!picked)throw new Error("먼저 제작 국가를 선택하세요");
      await api('/api/batch',{method:'POST',
        body:JSON.stringify({ids,operation:'region',region:picked.dataset.regionPick})});
      return {region:picked.dataset.regionPick,label:picked.textContent.trim()};
    }});
  modal.dialog.querySelectorAll('[data-region-pick]').forEach(chip=>applicationEffects.handler(chip, 'onclick', ()=>{
    modal.dialog.querySelectorAll('[data-region-pick]').forEach(other=>
      other.setAttribute('aria-pressed',String(other===chip)));
    modal.confirmButton.disabled=false;
  }));
  const {confirmed,result}=await modal.done;
  if(!confirmed)return;
  setSelectMode(false,true);await reloadAfterWrite();
  receiptsState.actionReceipt(result.region==='none'
    ? `제작 국가 지정 취소: ${ids.length}개` : `제작 국가 지정: ${result.label}：${ids.length} 개`);
}

export async function runFollowBatch(action,button){
  const items=[...followSelected];if(!items.length)return;
  const labels={save:"원장에 저장",seen:"시청 완료로 표시",ignored:"무시"};
  const titles={save:"선택한 항목 저장",seen:"시청 완료로 표시",ignored:"선택한 항목 무시"};
  return confirmModal({title:titles[action],body:`선택한 항목 ${items.length}개의 팔로우 항목을 처리합니다.`,confirmLabel:titles[action],danger:false,onConfirm:async()=>{
  setActionBusy(button);
  try{
    const path=action==='save'?'/api/follow/save':'/api/follow/status';
    const body=action==='save'?{items}:{items,to:action};
    await api(path,{method:'POST',body:JSON.stringify(body)});
    // 标记完按地址重读这一页：路由树的关注元素推一个新代次，列表重取、不重挂。
    setSelectMode(false,true);if(location.pathname==='/follow')writeShell({pageOpens:pageOpens+1});
    receiptsState.actionReceipt(`완료: ${labels[action]} ${items.length} 개`);
  }catch(error){setActionBusy(button,false);throw error}
  finally{setActionBusy(button,false);paintSelection()}
  }});
}

export async function runJunkBatch(operation,button){
  const ids=[...selected];if(!ids.length)return;
  const labels={'dismiss-junk':"정크 아님",'reconsider-junk':"다시 판별",dispose:"휴지통으로 이동"};
  const titles={'dismiss-junk':"정크 아님으로 표시",'reconsider-junk':"파일 다시 검사",dispose:"휴지통으로 이동"};
  return confirmModal({title:titles[operation],body:`선택한 항목 ${ids.length}개 파일을 처리합니다.`,confirmLabel:titles[operation],danger:false,onConfirm:async()=>{
  setActionBusy(button);
  try{
    await api('/api/batch',{method:'POST',body:JSON.stringify({ids,operation,
      ...(operation==='dispose'?{disposal_reason:'junk'}:{})})});
    setSelectMode(false,true);await loadCatalog();
    const inverse=operation==='dispose'?'restore':operation==='dismiss-junk'?'reconsider-junk':
      operation==='reconsider-junk'?'dismiss-junk':null;
    receiptsState.actionReceipt(`일괄 완료: ${labels[operation]}：${ids.length} 개`,{undo:inverse?async()=>{
      await api('/api/batch',{method:'POST',body:JSON.stringify({ids,operation:inverse})});
      await loadCatalog();
    }:null});
  }catch(error){setActionBusy(button,false);throw error}
  finally{setActionBusy(button,false);paintSelection()}
  }});
}

export function mountBatchDock(){
  loadBatchDock({root:$('[data-batch-dock]'),run:(group,operation,button)=>{void selectionState.BATCH_RUNNERS[group]?.(operation,button)}})
    .then(dock=>{dock.render(selectionState.batchDockProps);preferencesState.syncGlassOptics()}).catch(()=>{});
}

export function installSelection11() {
selectionState.batchDockProps = {count:0,context:'catalog',junkDismissed:false};
selectionState.trashCount = null;
selectionState.currentSelectSurface = ()=>selectionSurface(location.pathname);
applicationEffects.handler($('#selectMode'), 'onclick', ()=>setSelectMode(!selectMode,!selectMode?false:true));
selectionState.REGION_CHOICES = [['jp',"일본"],['kr',"한국"],['cn',"중국"],['west',"서양"],
  ['other',"기타"],['none',"지정 취소"]];
selectionState.BATCH_RUNNERS = {batch:runCatalogBatch,region:pickBatchRegion,follow:runFollowBatch,junk:runJunkBatch,
  clear:()=>setSelectMode(false,true)};
applicationEffects.handler($('#density'), 'onclick', ()=>{if(photoViewActive()){
    setPhotoSize(photoSize()==='big'?'small':'big');return}
  toggleDensity()});
applyDensity();
configureHoverPreview({
  selecting:()=>selectMode,
  censored:()=>censorOn(),
  delaySeconds:()=>preferencesState.appSettings.hoverDelaySeconds,
});
applicationEffects.listen(window, 'pagehide', ()=>releaseHoverPreviews());
applicationEffects.listen(document, 'visibilitychange', ()=>{if(document.hidden)releaseHoverPreviews()});
installCardArt();
selectionState.coverRecheck = 0;
applicationEffects.listen(window, 'resize', ()=>{
  refitNativeImages($('#index'));
  // 窗口放大后卡片跟着变大，先前够用的派生档可能就不够了；只增不减，换回来的原件留着。
  // 等拖动停下再量：逐张量尺寸要读样式和盒子，跟着每一帧 resize 跑就是一次次强制排版。
  clearTimeout(selectionState.coverRecheck);
  selectionState.coverRecheck=applicationEffects.delay(()=>$('#index').querySelectorAll('img.cover').forEach(img=>{
    if(img.complete)upgradeCover(img)}),200);
}, {passive:true});
}

function selectionSnapshot(){return {selectMode,selectSurface,lastSelectedId,followLastSelectedId}}
export function selectionDockProps(){return selectionDock({selected,followSelected},location.pathname,location.search,state.state)}

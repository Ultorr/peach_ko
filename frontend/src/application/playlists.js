/* playlists 域控制器：本域状态与动作，启动由 Application 的生命周期统一安装。 */
import { pageOpens, playlistsRevision, state, writeShell } from './../shell/index';
import { buildBars, catalogState, homePath } from './catalog.js';
import { navigationState, openRoutedPage } from './navigation.js';
import { enterManagementSurface, showHomeSurfaces, showManagementBody } from './layout.js';
import { openEntity } from './entity.js';
import { $, api, esc } from '../core';
import { checkboxHtml, formModal, noteHtml } from '../ui-kit';
import { disposeStage, openPlaylist } from './media.js';
import { receiptsState } from './receipts.js';
import { applicationEffects } from './effects';
import { releaseHoverPreviews } from './../card-art/hover';
import { managedEntry } from './../history/managed';
import { settingsPath } from '../history';
export const playlistsState = { playlistWrite: undefined };

export function openTasteSignal(kind,name){
  if(kind==='tag'){
    writeShell({state:{...state,tag:name,tag_match:'all',creator:'',studio:'',q:'',state:'',orient:''}});
    catalogState.clearSearchField();navigationState.route(homePath());showHomeSurfaces();buildBars();return
  }
  openEntity(kind,name);
}

export function playlistNameField(value=''){
  return `<label class="modalfield"><span>이름</span><input class="geist-input" name="name"
    maxlength="80" placeholder="이름 입력" value="${esc(value)}"></label>`;
}

export async function saveMixAsPlaylist({title,count,save}){
  const modal=formModal({
    title:"재생 목록으로 저장",
    description:`이 Mix의 동영상 ${count}개를 이어서 재생할 수 있는 목록으로 저장합니다.`,
    body:playlistNameField(title),
    confirmLabel:"재생 목록으로 저장",
    onConfirm:()=>{
      const name=modal.dialog.querySelector('[name="name"]').value.trim();
      if(!name)throw new Error("재생 목록 이름은 비워 둘 수 없습니다");
      return save(name);
    }});
  modal.dialog.querySelector('[name="name"]').select();
  const {confirmed,result}=await modal.done;
  if(!confirmed)return;
  await openPlaylist(result.id,result.current_asset_id,true);
  receiptsState.actionReceipt("재생 목록으로 저장했습니다",{undo:async()=>{
    await playlistsState.playlistWrite({action:'delete',id:result.id});openRoutedPage('/playlists');
  }});
}

export async function openAddToPlaylist(item){
  const lists=(await api('/api/playlists')).items||[];
  const rows=lists.map(list=>`<label class="pickrow">${checkboxHtml(`data-pick-playlist="${list.id}"`)}
    <span class="pickrowtext"><b>${esc(list.name)}</b><small>${list.item_count}개 동영상</small></span></label>`).join('');
  const modal=formModal({
    title:"재생 목록에 추가",
    description:"추가할 목록을 선택하거나 이름을 입력하여 새로 만드세요.",
    body:playlistNameField()+(rows
      ?`<div class="picklist" role="group" aria-label="기존 재생 목록">${rows}</div>`
      :noteHtml("재생 목록이 없습니다. 이름을 입력하여 새로 만드세요.",{size:'small'})),
    confirmLabel:"저장",
    confirmDisabled:true,
    onConfirm:async()=>{
      const name=modal.dialog.querySelector('[name="name"]').value.trim();
      const chosen=[...modal.dialog.querySelectorAll('[data-pick-playlist]:checked')]
        .map(box=>+box.dataset.pickPlaylist);
      const created=name
        ?(await playlistsState.playlistWrite({action:'create',name,asset_ids:[item.id]})).playlist:null;
      for(const id of chosen)await playlistsState.playlistWrite({action:'add',id,asset_ids:[item.id]});
      return {created,added:chosen};
    }});
  const sync=()=>{
    const name=modal.dialog.querySelector('[name="name"]').value.trim();
    modal.confirmButton.disabled=!name&&!modal.dialog.querySelector('[data-pick-playlist]:checked');
  };
  applicationEffects.listen(modal.dialog, 'input', sync);
  applicationEffects.listen(modal.dialog, 'change', sync);
  const {confirmed,result}=await modal.done;
  if(!confirmed)return;
  const total=(result.created?1:0)+result.added.length;
  receiptsState.actionReceipt(`추가한 재생 목록: ${total}개`,{undo:async()=>{
    for(const id of result.added)await playlistsState.playlistWrite({action:'remove',id,asset_id:item.id});
    if(result.created)await playlistsState.playlistWrite({action:'delete',id:result.created.id});
  }});
}

export function rereadPlaylists(){
  releaseHoverPreviews();disposeStage(false);enterManagementSurface();
  const entry=managedEntry($('#stats'));
  if(entry?.path!=='/playlists'||!entry.host.isConnected){writeShell({pageOpens:pageOpens+1});return}
  showManagementBody({manage:false});
  writeShell({playlistsRevision:playlistsRevision+1});
}

export function routeReview(params){
  navigationState.route('/review'+(params.category?'?category='+encodeURIComponent(params.category):''));
}

export function openConfigurationSection(section){
  writeShell({configurationRequestedSection:section});
  navigationState.navigatePath(settingsPath(section));
}

export function installPlaylists14() {
playlistsState.playlistWrite = body=>api('/api/playlist',{method:'POST',body:JSON.stringify(body)});
}

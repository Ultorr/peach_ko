/* tutorial 域控制器：本域状态与动作，启动由 Application 的生命周期统一安装。 */
import { cameFromSetup, writeShell } from './../shell/index';
import { isCurrentPostSetupTutorialRequest, nextPostSetupTutorialRequest, postSetupTutorialCollapsed, postSetupTutorialMarker, postSetupTutorialSignature, postSetupTutorialSkipped, resetPostSetupTutorialState, setPostSetupTutorialCollapsed, setPostSetupTutorialMarker, setPostSetupTutorialSkipped } from '../ui-kit';
import { peachHistory, shellNavigate } from './../history/index';
import { $, api, icon } from '../core';
import { navigationState } from './navigation.js';
import { applicationEffects } from './effects';
import { receiptsState } from './receipts.js';
export const tutorialState = { postSetupTutorialDone: undefined, postSetupTutorialNeedsReopen: undefined, postSetupTutorialTasks: undefined, postSetupTutorialHtml: undefined, writePostSetupTutorialDone: undefined, readPostSetupTutorialDone: undefined, openTutorialTarget: undefined };

export async function reopenPostSetupTutorial(){
  resetPostSetupTutorialState();
  await tutorialState.writePostSetupTutorialDone(false);
  await syncPostSetupTutorial();
}

export async function syncPostSetupTutorial(){
  const root=$('#postSetupTutorial');if(!root)return;
  const hide=()=>{root.hidden=true;root.innerHTML='';delete root.dataset.tutorialSignature;
    root.removeAttribute('aria-busy')};
  if(tutorialState.postSetupTutorialNeedsReopen){
    tutorialState.postSetupTutorialNeedsReopen=false;
    await tutorialState.writePostSetupTutorialDone(false).catch(()=>{});
  }
  if(postSetupTutorialMarker()!=='pending'||await tutorialState.readPostSetupTutorialDone()){hide();return}
  const request=nextPostSetupTutorialRequest();root.hidden=false;root.setAttribute('aria-busy','true');
  if(!root.firstElementChild){
    root.innerHTML=`<article class="post-setup-notification post-setup-loading">${icon('compass')}<p>설치 진행 상황 확인 중…</p></article>`;
  }
  try{
    const tasks=await tutorialState.postSetupTutorialTasks();
    if(!isCurrentPostSetupTutorialRequest(request))return;
    const knownKeys=new Set(tasks.map(task=>task.key));
    const skipped=new Set([...postSetupTutorialSkipped()].filter(key=>knownKeys.has(key)));
    setPostSetupTutorialSkipped(skipped);
    const visible=tasks.filter(task=>!skipped.has(task.key));
    const pending=visible.filter(task=>!task.done);
    if(!pending.length){
      setPostSetupTutorialMarker('complete');hide();
      await tutorialState.writePostSetupTutorialDone(true).catch(()=>{});
      return
    }
    const signature=postSetupTutorialSignature(visible);
    if(root.dataset.tutorialSignature===signature){root.removeAttribute('aria-busy');return}
    root.innerHTML=tutorialState.postSetupTutorialHtml(visible,skipped.size,tasks.length);
    root.dataset.tutorialSignature=signature;root.removeAttribute('aria-busy');
    const next=pending[0];
    const collapse=root.querySelector('[data-tutorial-collapse]');
    applicationEffects.handler(collapse, 'onclick', ()=>{
      const card=root.querySelector('.post-setup-notification');
      const collapsed=card.dataset.collapsed!=='true';
      card.dataset.collapsed=String(collapsed);setPostSetupTutorialCollapsed(collapsed);
      collapse.setAttribute('aria-expanded',String(!collapsed));
      collapse.setAttribute('aria-label',collapsed?"설치 안내 펼치기":"설치 안내 접기");
      collapse.innerHTML=icon(collapsed?'chevron-up':'chevron-down');
    });
    root.querySelectorAll('[data-tutorial-skip]').forEach(button=>applicationEffects.handler(button, 'onclick', ()=>{
      const skippedNow=postSetupTutorialSkipped(),key=button.dataset.tutorialSkip;
      skippedNow.add(key);setPostSetupTutorialSkipped(skippedNow);
      receiptsState.actionReceipt(`건너뜀: 「${button.dataset.tutorialLabel}」`,{undo:async()=>{
        const restored=postSetupTutorialSkipped();restored.delete(key);setPostSetupTutorialSkipped(restored);
        setPostSetupTutorialMarker('pending');await syncPostSetupTutorial();
      }});
      void syncPostSetupTutorial();
    }));
    const byKey=new Map(visible.map(task=>[task.key,task]));
    root.querySelectorAll('[data-tutorial-task]').forEach(link=>applicationEffects.handler(link, 'onclick', event=>{
      const task=byKey.get(link.dataset.tutorialTask);
      if(!task||event.metaKey||event.ctrlKey||event.shiftKey||event.button)return;
      event.preventDefault();tutorialState.openTutorialTarget(task);
    }));
    applicationEffects.handler(root.querySelector('[data-tutorial-action]'), 'onclick', ()=>tutorialState.openTutorialTarget(next));
  }catch{
    if(!isCurrentPostSetupTutorialRequest(request))return;
    /* 取数失败时这张卡是死的：没有清单，也没有下一步。给一条重试和一个关闭，
       不然它只能一直杵在右下角占着地方。 */
    root.innerHTML=`<article class="post-setup-notification post-setup-error">${icon('alert')}
      <div><h2>지금은 설치 진행 상황을 확인할 수 없습니다</h2><p>페이지를 전환하거나 다시 열면 재확인합니다.</p>
      <div class="post-setup-error-actions"><button class="geist-button" type="button" data-tutorial-retry>다시 시도</button>
      <button class="geist-button" type="button" data-tutorial-dismiss>닫기</button></div></div></article>`;
    root.removeAttribute('aria-busy');
    applicationEffects.handler(root.querySelector('[data-tutorial-retry]'), 'onclick', ()=>{
      delete root.dataset.tutorialSignature;root.innerHTML='';void syncPostSetupTutorial();
    });
    applicationEffects.handler(root.querySelector('[data-tutorial-dismiss]'), 'onclick', hide);
  }
}

export function installTutorial8() {
writeShell({cameFromSetup:new URLSearchParams(location.search).get('onboarding')==='1'});
tutorialState.postSetupTutorialDone = null;
tutorialState.postSetupTutorialNeedsReopen = false;
if(cameFromSetup){
  setPostSetupTutorialMarker('pending');
  // 账本里那句「教程做完了」可能是上一次安装留下的，刚走完设置就得撤回。
  tutorialState.postSetupTutorialDone=false;tutorialState.postSetupTutorialNeedsReopen=true;
  const clean=new URL(location.href);clean.searchParams.delete('onboarding');
  shellNavigate(clean,{replace:true,state:peachHistory.navigation.location.state});
}
{
  const clean=new URL(location.href),flag=clean.searchParams.get('agentation');
  if(flag==='on')localStorage.setItem('peach.agentation','on');
  if(flag==='off')localStorage.removeItem('peach.agentation');
  if(flag!==null){
    clean.searchParams.delete('agentation');
    shellNavigate(clean,{replace:true,state:peachHistory.navigation.location.state});
  }
  if(localStorage.getItem('peach.agentation')==='on')import('/dev/agentation.js').catch(()=>{});
}
tutorialState.postSetupTutorialTasks = async()=>{
  const {library,scraping,taste,follow,credentials,review}=await api('/api/post-setup-tutorial');
  const scrapingCredentialSources=(scraping.sources||[]).filter(source=>source.accepts_cookie);
  const savedScrapingCredentials=scrapingCredentialSources.filter(source=>source.cookie_saved);
  const sources=(follow.sources||[]).filter(source=>source.enabled!==false);
  const providers=new Map((credentials.providers||[]).map(row=>[row.provider,row]));
  const required=[...new Set(sources.map(source=>source.provider))]
    .map(provider=>providers.get(provider)).filter(row=>row?.requirement==='required');
  const libraryReady=Number(library.total||0)>0;
  const followReady=sources.length>0;
  const credentialsReady=followReady&&required.every(row=>row.present&&!row.missing?.length);
  const pendingReview=Object.values(review.counts||{})
    .reduce((sum,value)=>sum+(Number(value)||0),0);
  return [
    {key:'library',label:"첫 스캔 완료",description:libraryReady
      ?`가져온 컬렉션: ${Number(library.total).toLocaleString()}개.`:"스캔으로 첫 컬렉션 항목을 가져오기를 기다리고 있습니다.",
      href:'/data-cleanup',done:libraryReady,icon:'scan-search'},
    {key:'scraping',label:"수집 소스 및 인증 정보 설정",description:savedScrapingCredentials.length
      ?`인증 정보를 저장한 수집 소스: ${savedScrapingCredentials.length.toLocaleString()}개.`
      :"소스 연결 방식을 확인하고 로그인이 필요한 소스의 인증 정보를 저장하세요.",
      href:'/sources',done:savedScrapingCredentials.length>0,icon:'settings'},
    {key:'history',label:"브라우저 방문 기록 가져오기",description:Number(taste.history_sources||0)>0
      ?`가져온 브라우저 방문 기록: ${Number(taste.history_sources).toLocaleString()}개.`
      :"이 기기의 브라우저에서 취향 분석용 기록을 가져옵니다.",
      href:'/taste',setupEntry:true,done:Number(taste.history_sources||0)>0,icon:'history'},
    {key:'follow',label:"팔로우 소스 추가",description:followReady
      ?`활성화한 소스: ${sources.length.toLocaleString()}개.`:"계속 확인할 크리에이터나 소스를 추가하세요.",
      href:'/subscriptions?tab=add',done:followReady,icon:'rss'},
    {key:'credentials',label:"팔로우 소스 인증 정보 추가",description:!followReady
      ?"팔로우를 추가하면 소스별로 필요한 인증 정보를 확인합니다.":required.length
        ?(credentialsReady?"현재 소스에 필요한 인증 정보를 설정했습니다.":`${required.length.toLocaleString()}개 소스에 인증 정보가 필요합니다.`)
        :"현재 팔로우 소스에는 인증 정보가 필요하지 않습니다.",
      href:'/subscriptions?tab=source',done:credentialsReady,icon:'key-round'},
    {key:'review',label:"첫 검토 처리",description:!libraryReady
      ?"스캔이 완료되면 검토가 필요한 정보를 표시합니다.":pendingReview
        ?`검토 대기: ${pendingReview.toLocaleString()}개.`:"첫 검토 대기 목록을 모두 처리했습니다.",
      href:'/review',done:libraryReady&&pendingReview===0,icon:'square-check-big'},
  ];
};
tutorialState.postSetupTutorialHtml = (tasks,skippedCount,totalCount)=>{
  const ordered=[...tasks].sort((left,right)=>Number(left.done)-Number(right.done));
  const next=tasks.find(task=>!task.done);
  const completeCount=tasks.filter(task=>task.done).length+skippedCount;
  const collapsed=postSetupTutorialCollapsed();
  const rows=ordered.map(task=>`<li class="post-setup-task" data-state="${task.done?'checked':'unchecked'}">
    <a href="${task.href}" data-tutorial-task="${task.key}">
      <span class="post-setup-check" aria-hidden="true">${task.done?icon('check'):icon(task.icon)}</span>
      <span><b>${task.label}</b><small>${task.description}</small></span>
      ${icon('chevron-right')}</a>
    ${task.done?'':`<button class="post-setup-skip" type="button" data-tutorial-skip="${task.key}" data-tutorial-label="${task.label}">건너뛰기</button>`}
    </li>`).join('');
  return `<article class="post-setup-notification" data-collapsed="${collapsed}">
      <header class="post-setup-notification-head">
        <span class="post-setup-notification-icon" aria-hidden="true">${icon('compass')}</span>
        <div><h2>Peach 설치 안내 완료하기</h2>
        <p>완료: ${completeCount}/${totalCount}개.</p></div>
        <button class="post-setup-collapse" type="button" data-tutorial-collapse aria-controls="postSetupTaskList" aria-expanded="${!collapsed}"
          aria-label="${collapsed?"설치 안내 펼치기":"설치 안내 접기"}">${icon(collapsed?'chevron-up':'chevron-down')}</button>
      </header>
      <ol class="post-setup-task-list" id="postSetupTaskList">${rows}</ol>
      <footer><button class="geist-button" type="button" data-tutorial-action="next">계속: ${next.label}</button></footer>
    </article>`;
};
tutorialState.writePostSetupTutorialDone = async done=>{
  tutorialState.postSetupTutorialDone=done;
  await api('/api/settings',{method:'POST',body:JSON.stringify({postSetupTutorialDone:done})});
};
tutorialState.readPostSetupTutorialDone = async()=>{
  if(tutorialState.postSetupTutorialDone===null){
    try{tutorialState.postSetupTutorialDone=(await api('/api/settings')).postSetupTutorialDone===true}
    catch{tutorialState.postSetupTutorialDone=false}
  }
  return tutorialState.postSetupTutorialDone;
};
tutorialState.openTutorialTarget = task=>{
  if(task.setupEntry)writeShell({cameFromSetup:true});
  navigationState.navigatePath(task.href);
};
}

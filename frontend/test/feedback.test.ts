import {describe,expect,it} from 'vitest';
import {requestErrorMessage} from '../src/core';
import {noteHtml,projectBannerHtml,gaugeHtml,progressHtml,configurationSkeletonHtml} from '../src/ui-kit';

describe('中文错误反馈',()=>{
  it.each(['Failed to fetch','NetworkError when attempting to fetch resource.','Load failed'])('网络异常 %s 给出连接检查方法',message=>{
    expect(requestErrorMessage(new TypeError(message))).toBe('Peach 서비스에 연결할 수 없습니다. 네트워크 연결과 트레이 서비스 실행 상태를 확인하세요.');
  });
  it.each([[401,'로그인이 만료되었습니다'],[403,'해당 작업을 실행할 수 없습니다'],[404,'더 이상 없습니다'],[429,'요청이 너무 잦습니다'],[503,'일시적으로 사용할 수 없습니다'],[504,'시간이 초과되었습니다']])('HTTP %s 使用明确原因', (code,reason)=>{
    expect(requestErrorMessage('request failed',code)).toContain(reason);
  });
  it('正文里的 timeout 字样不把 500 读成超时',()=>{
    expect(requestErrorMessage('Traceback: httpx.ReadTimeout raised in handler (timeout=30)',500))
      .toBe('Peach 서비스 처리에 실패했습니다. 다시 시도하고, 계속 실패하면 트레이 로그를 확인하세요.');
    expect(requestErrorMessage('read timed out')).toContain('시간이 초과되었습니다');
  });
  it('本机接口的 502 说的是 Peach 服务，不提代理',()=>{
    const text=requestErrorMessage('Bad Gateway',502);
    expect(text).toContain('Peach 서비스');
    expect(text).not.toContain('프록시');
  });
  it.each(['현재 접근 비밀번호가 올바르지 않습니다', new Error('현재 접근 비밀번호가 올바르지 않습니다')])('保留服务端明确的韩文原因',cause=>{
    expect(requestErrorMessage(cause,409)).toBe('현재 접근 비밀번호가 올바르지 않습니다');
  });
  it.each([
    {cause:'요청 실패 (401）',status:401,message:'로그인이 만료되었습니다. 새로고침한 뒤 다시 로그인하세요.'},
    {cause:new Error('요청 실패 (503）'),status:0,message:'Peach 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.'},
    {cause:'请求失败（403）',status:403,message:'이 기기에서는 해당 작업을 실행할 수 없습니다. Peach를 실행 중인 컴퓨터에서 작업하세요.'},
  ])('通用失败包装使用 HTTP 原因，只有具体原因原样保留',({cause,status,message})=>{
    expect(requestErrorMessage(cause,status)).toBe(message);
  });
  it('保留服务端明确的中文原因',()=>{
    expect(requestErrorMessage('媒体盘没有挂载，请先连接媒体盘。',409)).toBe('媒体盘没有挂载，请先连接媒体盘。');
  });
});
describe('持久提示控件',()=>{
  it('配置骨架标题和卡片共用真实页面网格与正文底栏',()=>{
    const host=document.createElement('div');host.innerHTML=configurationSkeletonHtml();
    const page=host.querySelector('.ui-configpage')!;
    expect(page.querySelectorAll(':scope > .ui-configgroup')).toHaveLength(5);
    expect(page.querySelectorAll(':scope > .configfieldset')).toHaveLength(12);
    for(const card of page.querySelectorAll('.configfieldset')){
      expect(card.querySelector(':scope > .geist-fieldset-content')).not.toBeNull();
      expect(card.querySelector(':scope > .geist-fieldset-footer')).not.toBeNull();
    }
    expect(host.children).toHaveLength(1);
  });
  it.each([[79,'normal'],[80,'warning'],[94,'warning'],[95,'error']])('容量 %s 使用一致阈值', (value,level)=>{
    const host=document.createElement('div');host.innerHTML=gaugeHtml('空间使用率',value,100,{usage:true});
    expect(host.querySelector('.ui-geist-gauge')?.getAttribute('data-level')).toBe(level);
    expect(gaugeHtml('完成率',value,100)).toContain('data-level="normal"');
  });
  it('失败提示包含一个内部操作按钮',()=>{
    const host=document.createElement('div');host.innerHTML=noteHtml('来源离线',{variant:'error',filled:true,actionLabel:'重试'});
    expect(host.querySelectorAll('[role=alert] button')).toHaveLength(1);
  });
  it('容量比例和任务计数使用真实上限，未知容量不显示零',()=>{
    const host=document.createElement('div');host.innerHTML=gaugeHtml('使用率',25,50);
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(gaugeHtml('使用率',0,0)).toContain('가져오지 못함');
    host.innerHTML=progressHtml('分析记录',3,10,{stops:[{value:5,label:'分析结束'}],variant:'warning'});
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuemax')).toBe('10');
    expect(host.querySelector('[aria-label="分析结束"]')).not.toBeNull();
  });
  it('Note 错误不会直接输出英文网络异常',()=>{
    const host=document.createElement('div');host.innerHTML=noteHtml('Failed to fetch',{variant:'error',size:'small',filled:true});
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Peach 서비스에 연결할 수 없습니다');
    expect(host.querySelector('.geist-note-small.geist-note-filled')).not.toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });
  it('Project Banner 包含处理入口且没有关闭键',()=>{
    const host=document.createElement('div');host.innerHTML=projectBannerHtml('扫描未完成',{variant:'warning',href:'/data-cleanup',label:'查看并处理'});
    expect(host.querySelector('.ui-project-banner-warning')).not.toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/data-cleanup');
    expect(host.querySelector('button')).toBeNull();
  });
});

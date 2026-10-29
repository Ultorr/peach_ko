import { expect, it, vi } from 'vitest';

it('独立页面的 API 错误反馈不初始化界面分段器', async () => {
  vi.resetModules();
  const segmenter = vi.spyOn(Intl, 'Segmenter');
  const { errorMessage } = await import('../src/api');
  expect(errorMessage(new TypeError('Failed to fetch'))).toContain('Peach 서비스에 연결할 수 없습니다');
  expect(segmenter).not.toHaveBeenCalled();
});

it.each([
  ['get',401,'로그인이 만료되었습니다. 새로고침한 뒤 다시 로그인하세요.'],
  ['send',503,'Peach 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.'],
] as const)('非 JSON 的 %s 失败保留状态并显示对应原因',async(method,status,message)=>{
  const {apiGet,apiSend}=await import('../src/api');
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('not JSON',{status}));
  const request=method==='get'?apiGet('/api/test'):apiSend('/api/test',{});
  await expect(request).rejects.toMatchObject({name:'ApiError',status,message});
});

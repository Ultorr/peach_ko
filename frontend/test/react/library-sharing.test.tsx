import { describe, expect, it, vi } from 'vitest';

import { LibrarySharingSettings, type LibrarySharingState } from '../../src/react/settings/library-sharing-settings';
import { buttonNamed, click, mount, settle, switches } from './render';

const initial: LibrarySharingState = { enabled: false, available: true, schema: 4,
  fields: ['作品编号、标签、评分与全部偏好维度'], notice: '匿名处理后上传馆藏与各类偏好明细。' };

describe('馆藏与口味分享的明确同意', () => {
  it('开关始终可见，上传预览和明确同意完整后才能开启', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/preview')
      ? { data: { library: [{ code: 'EXM-001' }], preferences: {}, coverage: { uncoded_items: 0 } }, bytes: 80, token: 'preview-token', schema: 4 }
      : { ...initial, enabled: true } }));
    vi.stubGlobal('fetch', fetcher);
    const receipt = vi.fn();
    const host = await mount(<LibrarySharingSettings initial={initial} receipt={receipt} />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain(initial.notice);
    expect(switches(host)[0]?.checked).toBe(false);
    await click(switches(host)[0]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(switches(host)[0]?.checked).toBe(false);
    expect(host.textContent).not.toContain(initial.fields[0]);
    expect(host.querySelector('input[type="checkbox"]:not([role="switch"])')).toBeNull();
    await click(buttonNamed('업로드 내용 미리보기', host));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('KiB입니다. 계정, 기기, 파일 경로, 브라우저 방문 기록 등의 개인 데이터는 포함되지 않습니다.');
    expect((buttonNamed('동의하고 업로드 켜기', host) as HTMLButtonElement).disabled).toBe(true);
    await click(host.querySelector('input[type="checkbox"]:not([role="switch"])'));
    await click(buttonNamed('동의하고 업로드 켜기', host));
    await settle();
    const call = fetcher.mock.calls[1]! as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ enabled: true, schema: 4, consent: true, preview_token: 'preview-token' });
    expect(receipt).toHaveBeenCalledWith('컬렉션 및 취향 업로드 옵션을 저장했습니다');
    expect(switches(host)[0]?.checked).toBe(true);
    expect(host.textContent).not.toContain(initial.fields[0]);
    expect(host.querySelector('pre')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]:not([role="switch"])')).toBeNull();
    expect(buttonNamed('업로드 내용 미리보기', host)).not.toBeNull();
  });

  it('关闭不要求重新预览或勾选', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => initial }));
    vi.stubGlobal('fetch', fetcher);
    const host = await mount(<LibrarySharingSettings initial={{ ...initial, enabled: true }} receipt={vi.fn()} />);
    await click(switches(host)[0]!);
    await settle();
    const call = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).enabled).toBe(false);
    expect(switches(host)[0]?.checked).toBe(false);
  });

  it('预览失败时保留关闭状态，可重试且不报保存成功', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ detail: '读取失败' }) }));
    vi.stubGlobal('fetch', fetcher);
    const receipt = vi.fn();
    const host = await mount(<LibrarySharingSettings initial={initial} receipt={receipt} />);
    await click(switches(host)[0]);
    await click(buttonNamed('업로드 내용 미리보기', host));
    await settle();
    expect(switches(host)[0]?.checked).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取失败');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(receipt).not.toHaveBeenCalled();
  });
});

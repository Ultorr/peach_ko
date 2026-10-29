import { expect, it, vi } from 'vitest';

import { currentLine, processingError, processingLine, remainingTime } from '../../src/react/library-processing/library-processing';
import type { SidebarFacets } from '../../src/react/sidebar/sidebar-api';
import { ProcessingNoticePanel } from '../../src/react/library-processing/library-processing-notice';
import { mount } from './render';

vi.mock('../../src/application/tutorial.js', () => ({
  reopenPostSetupTutorial: vi.fn(), installTutorial8: vi.fn(), syncPostSetupTutorial: vi.fn(),
}));

const PREFERENCES_MODULE = '../../src/application/preferences.js';
const { sidebarFacets } = await import(/* @vite-ignore */ PREFERENCES_MODULE) as {
  sidebarFacets(facets: Record<string, unknown>, context: { type: string }): SidebarFacets;
};

it('분류는 한국어로 표시하고 필터 값과 사용자 이름은 보존한다', () => {
  const input = {
    regions: [{ k: 'none', label: '未判定', n: 7 }, { k: 'west', label: '欧美', n: 3 },
      { k: 'future', label: 'Future region', n: 2 }],
    orientations: [{ k: '横屏', n: 3 }, { k: '竖屏', n: 2 }],
    creators: [{ k: '欧美', n: 1 }, { k: '制服', n: 2 }],
    tags: [{ k: '制服', n: 4 }, { k: '骑乘', label: '骑乘位', n: 3 },
      { k: 'custom', label: '나의 태그', n: 2 }],
  };
  const original = structuredClone(input);
  const facets = sidebarFacets(input, { type: 'catalog' });
  expect(facets.regions).toEqual([
    { value: 'none', label: '미분류', n: 7 }, { value: 'west', label: '서양', n: 3 },
    { value: 'future', label: 'Future region', n: 2 },
  ]);
  expect(facets.orientations).toEqual([
    { value: '横屏', label: '가로', n: 3 }, { value: '竖屏', label: '세로', n: 2 },
  ]);
  expect(facets.creators).toEqual([{ value: '欧美', label: '欧美', n: 1 }, { value: '制服', label: '制服', n: 2 }]);
  expect(facets.tags).toEqual([
    { value: '制服', label: '제복', n: 4 }, { value: '骑乘', label: '기승위', n: 3 },
    { value: 'custom', label: '나의 태그', n: 2 },
  ]);
  expect(input).toEqual(original);
});

it('서버의 중국어 단계와 예상 시간 범위를 한국어로 표시하고 원본 상태는 유지한다', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const state = {
    status: 'running', stage: '扫描文件', scanned: 1234,
    eta_seconds_min: 60, eta_seconds_max: 120, eta_kind: 'measured' as const,
    eta_scope: '本趟处理（已登记文件，未含未知新增）',
    steps: [
      { id: 'sources', label: '扫描文件', status: 'current' as const },
      { id: 'sidecars', label: '检查配套文件', status: 'pending' as const },
      { id: 'probe', label: '读取媒体属性与生成预览', status: 'pending' as const },
      { id: 'metadata', label: '采集外部资料与封面', status: 'pending' as const },
    ],
  };
  const original = structuredClone(state);
  expect(currentLine(state)).toBe('파일 스캔');
  expect(processingLine(state)).toBe('파일 스캔 · 발견: 1,234 개 파일');
  expect(remainingTime(state)).toContain('등록된 파일 기준 · 새 파일 제외');
  const panel = await mount(<ProcessingNoticePanel state={state} />);
  expect(panel.querySelector('ol')?.textContent).toContain('연관 파일 확인');
  expect(panel.querySelector('ol')?.textContent).toContain('미디어 속성 읽기 및 미리보기 생성');
  expect(panel.querySelector('ol')?.textContent).toContain('외부 정보 및 표지 수집');
  expect(panel.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  expect(state).toEqual(original);
  vi.unstubAllGlobals();
});

it('작업 오류 요약의 숫자는 유지하고 알 수 없는 외부 오류는 보존한다', () => {
  expect(processingError('3 项都卡在来源限流上，等一会儿再跑一次。')).toBe('3개 항목 모두 소스의 요청 제한으로 대기 중입니다. 잠시 후 다시 실행하세요.');
  expect(processingError('7 项需要处理，其中 2 项是来源限流，等一会儿再跑；其余可重试未完成的部分。')).toContain('7개 항목을 처리해야 합니다. 이 중 2개는');
  expect(processingError('4 项需要处理，可重试未完成的部分。')).toBe('4개 항목을 처리해야 합니다. 미완료 항목을 다시 시도할 수 있습니다.');
  expect(processingError('处理被中断。核对媒体目录后重试。')).toContain('미디어 폴더를 확인');
  const external = 'provider: 4 项需要处理，可重试未完成的部分。';
  expect(processingError(external)).toBe(external);
});

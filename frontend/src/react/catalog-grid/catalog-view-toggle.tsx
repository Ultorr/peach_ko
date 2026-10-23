import { Radio, RadioGroup } from 'react-aria-components';
import { RiLayoutGridLine, RiListUnordered } from '@remixicon/react';
import { SEGMENTED_GLASS_TRACK, SEGMENT_GLASS } from '../components/segmented';
import { setCatalogView, useCatalogView } from './catalog-view';

export function CatalogViewToggle() {
  const view = useCatalogView();
  return <RadioGroup aria-label="컬렉션 표시 방식" orientation="horizontal" value={view} onChange={setCatalogView}
    data-entity-layout="" className={SEGMENTED_GLASS_TRACK}>
    <Radio value="cards" aria-label="카드" className={SEGMENT_GLASS} data-glass-segment="">
      <span title="카드" className="pointer-events-none contents"><RiLayoutGridLine aria-hidden="true" className="size-4" /></span>
    </Radio>
    <Radio value="list" aria-label="목록" className={SEGMENT_GLASS} data-glass-segment="">
      <span title="목록" className="pointer-events-none contents"><RiListUnordered aria-hidden="true" className="size-4" /></span>
    </Radio>
  </RadioGroup>;
}

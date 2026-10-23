import { Button } from '@/components/base/buttons/button';
import { DOTS, paginationRange } from '../../pagination';

export function Pagination({ page, pages, onPage, label = "팔로우 목록 페이지 탐색" }: {
  page: number; pages: number; onPage(page: number): void; label?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-2">
      <Button variant="secondary" size="small" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전 페이지</Button>
      <ul className="flex flex-wrap items-center gap-1">
        {paginationRange(page, pages).map((item, at) => (
          <li key={item === DOTS ? `dots-${at}` : item}>
            {item === DOTS ? <span aria-hidden className="px-1 text-body-2-regular text-text-tertiary">{DOTS}</span>
              : <Button variant={item === page ? 'secondary' : 'ghost'} size="small"
                  aria-label={`제 ${item} 페이지`} aria-current={item === page ? 'page' : undefined}
                  onClick={() => onPage(Number(item))}>{item}</Button>}
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="small" disabled={page >= pages} onClick={() => onPage(page + 1)}>다음 페이지</Button>
    </nav>
  );
}

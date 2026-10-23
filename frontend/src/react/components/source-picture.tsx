import { useQuery } from '@tanstack/react-query';
import { coverUrl } from '@peach/card-art';
import { apiGet } from '../../api';
import { Button } from '@/components/base/buttons/button';
import { Note } from './note';
import { busyProps } from '../settings/use-action';
import type { JavDetail } from '../jav-detail/jav-detail';

/** 来源图片复用查询及持久图片缓存。 */
export function SourcePicture({ item, image, thumbnail = false }: {
  item: Pick<JavDetail, 'code' | 'has_cover' | 'source_image' | 'cover_url' | 'cover_version'>;
  image: string; thumbnail?: boolean;
}) {
  const local = image === 'cover' && item.has_cover;
  const remote = !local && (image !== 'cover' || item.source_image);
  const result = useQuery({ queryKey: ['jav-image', item.code, image], enabled: remote, staleTime: Infinity,
    queryFn: ({ signal }) => apiGet<{ ok: boolean; image: string; message?: string }>(
      `/api/jav/image?code=${encodeURIComponent(item.code)}&image=${image}`, signal) });
  const src = local ? coverUrl(item, true) : result.data?.image || (image === 'cover' && !item.source_image ? item.cover_url : '');
  if (src) return <img data-jav-picture={thumbnail ? undefined : ''} src={src} alt={thumbnail ? '' : image === 'cover' ? `${item.code} 표지` : `${item.code} 미리 보기 ${Number(image) + 1}`} referrerPolicy="no-referrer" />;
  if (thumbnail) return remote && result.isPending ? <span className="relative block h-full w-full skeleton-sheen" aria-label="미리 보기를 읽는 중" /> : <span>미리 보기를 가져오지 못했습니다</span>;
  if (remote && result.isPending) return <div data-jav-picture-wait="" data-skeleton="image" role="status" aria-label="이미지를 읽는 중"><span className="relative skeleton-sheen" /></div>;
  return <div data-jav-picture-wait=""><Note tone="neutral" action={remote ? <Button variant="secondary" {...busyProps(result.isFetching)} onClick={() => { void result.refetch() }}>다시 시도</Button> : undefined}>{result.data?.message || (result.error ? "이미지를 가져오지 못했습니다" : "표지를 가져오지 못했습니다")}</Note></div>;
}

import { fmtSize } from '@peach/legacy/core';

/** 来源的字节数按馆藏容量口径展示，其他来源单位保留。 */
export function resourceSize(value: string): string {
  const bytes = /^([\d,]+)\s*B$/i.exec(value.trim());
  if (/^[\d,.]+$/.test(value.trim())) return "크기 알 수 없음";
  return bytes ? fmtSize(Number(bytes[1].replaceAll(',', ''))) : value || "크기 알 수 없음";
}

/** 缓存中的来源限制只表述本次取得范围，不推断账号权限。 */
export function resourceNotice(value: string): string {
  return /^更多评论.*(?:VIP|官方 App)/.test(value)
    ? "소스에서 일부 댓글만 반환하여 리소스 링크가 누락되었을 수 있습니다."
    : value;
}

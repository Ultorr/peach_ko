/* 设置完成：扫描是否已排队、进入 Peach 的入口，运行信息默认折叠。口令不出现在页面上。
 *
 * 独立包的服务端在 `redirect` 里给入口地址，过 `RESTART_REDIRECT_MS` 自己跳过去，与配置页保存后
 * 等托盘换进程的时长是同一个数。 */
import { useEffect, useRef } from 'react';

import { ButtonLink } from '@/components/base/buttons/button';

import { RESTART_REDIRECT_MS } from '../../restart-redirect';
import { Disclosure, ExternalLink, Fact, FactList } from '../../settings/section';
import { AuthCard } from '../auth-card';
import type { SetupDone } from './setup-api';

export function SetupDoneView({ done }: { done: SetupDone }) {
  const entry = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    document.title = "Peach · 설정 완료";
    entry.current?.focus();
  }, []);

  useEffect(() => {
    const target = done.redirect;
    if (!target) return undefined;
    const timer = setTimeout(() => location.assign(target), RESTART_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [done.redirect]);

  return (
    <AuthCard title="설정 완료" lede="컬렉션을 시작하는 중입니다.">
      <p className="text-body-regular text-text-primary">
        {done.restored ? "기존 데이터 폴더에 연결되었습니다." : done.scan_requested
          ? "첫 스캔이 대기열에 추가되었습니다. 백그라운드에서 미디어 라이브러리를 정리하는 동안에도 Peach를 사용할 수 있습니다."
          : "나중에 설정 페이지에서 미디어 라이브러리 스캔을 시작하세요."}
      </p>
      <ButtonLink ref={entry} href={done.url} className="self-start">
        {done.history_guide ? "브라우저 방문 기록 가져오기" : "Peach 시작"}
      </ButtonLink>
      <Disclosure summary="실행 정보">
        <FactList>
          {done.facts.map((fact) => (
            <Fact key={fact.term} term={fact.term}>
              {fact.value}
              {fact.download_url
                ? <ExternalLink href={fact.download_url}>{fact.download_label ?? fact.download_url}</ExternalLink>
                : null}
            </Fact>
          ))}
        </FactList>
      </Disclosure>
    </AuthCard>
  );
}

/* 媒体来源选了网盘时的 CloudDrive 起步配置。
 *
 * 页内只留填哪里、填多少、怎么确认；三处缓存的分工、换算与起步值的来源在
 * `docs/CLOUDDRIVE.md`，这里链过去，同一段话不在两处维护。 */
import { Disclosure, ExternalLink, Help } from './section';

export const CLOUDDRIVE_PROFILES = [
  { name: "HDD 또는 메모리 8 GB 이하", cache: '10–20 GiB', read: '256 / 128 KB', task: "1개" },
  { name: "SATA SSD, 메모리 8~16 GB", cache: '20–50 GiB', read: '256 / 128 KB', task: "1~2개" },
  { name: "NVMe SSD, 메모리 16 GB 이상", cache: '50–100 GiB', read: '256 / 128 KB', task: "2개부터 시작" },
] as const;

const READINGS = [['cache', "캐시 한도"], ['read', "읽기 길이(기본/최소)"], ['task', "동시 처리 동영상 수"]] as const;

export function CloudDriveGuide() {
  return (
    <div className="@container flex flex-col gap-3">
      <Disclosure summary="CloudDrive 설정 도움말">
        <Help>
          먼저 CloudDrive2 또는 OpenList의 클라우드 드라이브를 로컬 폴더로 마운트한 후 여기에서 선택하세요.
          <ExternalLink href="https://www.clouddrive2.com/help.html">마운트 도움말</ExternalLink>
        </Help>
        <Help>캐시가 저장된 드라이브와 사용 가능한 메모리를 기준으로 초기값을 정한 후 재생 상태에 따라 조정하세요.</Help>
        <Help>파일 작업에는 마운트 도구와 클라우드 드라이브 계정의 쓰기 권한이 필요합니다. 光鸭云盘의 업로드, 폴더 생성, 이름 변경 및 이동에는 CloudDrive2 v1.1.0 이상이 필요하며, 삭제 및 복사는 아직 지원하지 않습니다.</Help>
        {/* 三档同形、跨档比较：窄处每档一块纵排，宽处三项读数排成三列对齐。 */}
        <ul aria-label="캐시 저장 드라이브별 권장값" className="flex flex-col gap-2">
          {CLOUDDRIVE_PROFILES.map((profile) => (
            <li key={profile.name} className="flex flex-col gap-2 rounded-2lg border border-separator-border bg-background-primary-default p-3">
              <p className="text-body-medium text-text-primary">{profile.name}</p>
              <dl className="inline-grid grid-cols-1 gap-2 @md:grid-cols-3">
                {READINGS.map(([key, term]) => (
                  <div key={key} className="flex flex-col">
                    <dt className="text-caption-1-regular text-text-secondary">{term}</dt>
                    <dd className="text-body-regular text-text-primary">{profile[key]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-2-regular text-text-secondary">
          <li>캐시 한도와 정리 방식은 CloudDrive의 「설정」에서 지정하고 정리 방식은 LRU를 선택하세요. 한도에 0을 입력하지 말고 시스템 드라이브에 최소 40 GiB를 남겨 두세요. 입력 후 설정 페이지를 다시 열어 저장 여부를 확인하세요.</li>
          <li>읽기 길이와 다운로드 스레드 수는 각 클라우드 드라이브의 다운로드 설정에서 지정하세요. 스레드 수는 모두 2부터 시작하세요.</li>
          <li>Buffer Cache는 메모리를 사용하고, 디스크 캐시와 폴더 캐시는 디스크를 사용합니다. 한 설정을 바꿔도 나머지 두 설정에는 적용되지 않습니다.</li>
        </ul>
        <Help>
          <ExternalLink href="https://github.com/peach-mitao/peach/blob/master/docs/CLOUDDRIVE.md">전체 설정 및 성능 조정 안내</ExternalLink>
        </Help>
      </Disclosure>
    </div>
  );
}

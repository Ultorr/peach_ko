<p align="center">
  <img src="resources/peach-logo.png" alt="Peach" width="96">
</p>

# Peach 한국어판

**Peach 0.46.1 기반의 비공식 한국어 현지화 포크입니다.** 원본 개발자의 공식 한국어 배포판이 아닙니다. 이번 공개 범위는 수정한 소스와 빌드 문서이며, 설치 프로그램이나 실행 파일을 배포하지 않습니다.

Peach는 로컬 디스크, 마운트된 클라우드 드라이브와 팔로우한 크리에이터의 콘텐츠를 한곳에서 관리하는 개인용 미디어 라이브러리입니다. 성인 사용자가 자신의 콘텐츠를 관리하기 위한 프로그램이며, 이 저장소는 사용자 미디어나 사이트 데이터를 포함하지 않습니다.

- [한국어판 소스](https://github.com/Ultorr/peach_ko/tree/korean-0.46.1)
- [원본 프로젝트](https://github.com/peach-mitao/peach) · [원본 웹사이트](https://peach.video)
- [한국어 변경 내역](KOREAN_CHANGES.md) · [소스 빌드 안내](docs/BUILD_KO.md)
- [라이선스 안내](LOCALIZATION_LICENSE.md) · [AGPL 전문](LICENSE)

## 기반과 변경 고지

기반은 [Peach 0.46.1의 커밋 af772ddf90b3701b419ce09c8123a3f956b0f880](https://github.com/peach-mitao/peach/tree/af772ddf90b3701b419ce09c8123a3f956b0f880)입니다.

**변경일: 2026-10-24.** 이 포크는 화면 문구, 초기 설정, 서버의 사용자 안내, 트레이 메뉴, 플레이어 언어와 일부 동적 표시값을 한국어로 수정했습니다. 원저작권 **Copyright (C) 2026 longmeidao**와 기존 고지를 유지하며, 수정본은 **AGPL-3.0-or-later**로 제공합니다. 현지화 기여 내역은 이 포크의 커밋 이력에서 확인할 수 있습니다.

## 한국어 지원 범위

홈, 검색, 설정, 라이브러리 관리, 팔로우, 작업 안내, 초기 설정과 로그인 화면의 프로그램 문구를 한국어로 제공합니다. 날짜 표시와 플레이어 언어를 한국어 환경에 맞추고, 좁은 화면에서 한국어 단어가 부자연스럽게 끊어지는 문제를 줄였습니다.

API에서 전달되는 제작 지역·화면 방향, 처리 단계·남은 시간 범위도 표시 단계에서 번역합니다. 내부 식별값, 필터값, 데이터베이스 구조와 요청 형식은 유지합니다.

사용자가 지정한 이름, 파일 경로, 미디어 제목, 인물·스튜디오 이름과 원본 콘텐츠 태그는 자동 번역하지 않습니다. 외부 서비스가 반환하는 문구나 저장된 과거 기록에는 원문이 남을 수 있습니다. 자세한 범위는 [한국어 변경 내역](KOREAN_CHANGES.md)을 확인하세요.

타입 검사와 새 환경의 기본 빌드·초기 실행을 확인했으며, 회귀 테스트의 표시 문구 기대값을 한국어판에 맞게 정비했습니다. 전체 검사 환경과 실행 방법은 [빌드 안내](docs/BUILD_KO.md#전체-회귀-검사), 검증 대상과 외부 서비스의 한계는 [검증 범위](KOREAN_CHANGES.md#검증-범위)를 확인하세요.

## 폴더·여러 영상의 별점 일괄 지정

1. 상단 **폴더 모드**에서 폴더를 선택합니다. **하위 폴더 포함**을 켜거나 끄고 **폴더 영상 전체 선택**을 누릅니다. 이 버튼은 검색·태그·현재 페이지와 관계없이 해당 폴더의 영상을 선택하며, 기존 선택을 교체합니다.
2. 일부 영상만 지정하려면 카드 또는 목록의 체크박스를 사용합니다. 첫 항목을 선택한 뒤 **Shift+클릭**하면 현재 화면의 두 항목 사이를 선택합니다. 목록 머리글 체크박스는 현재 페이지를 선택합니다.
3. 하단 **별점 지정**에서 **1~5점** 또는 **별점 해제**를 선택하고 **별점 적용**을 누릅니다. 같은 점수를 다시 적용해도 별점이 해제되지 않습니다.

영상 재생 없이 기존 별점을 덮어씁니다. 저장 완료까지 탭을 열어 두세요. 오류가 나면 완료 개수와 남은 개수가 표시되며, 같은 창에서 다시 적용하면 완료한 항목을 건너뜁니다. 영상이 아닌 항목은 제외합니다. 폴더 스캔으로 목록이 바뀌면 폴더 선택을 다시 시도하세요.

## 소스에서 실행하기

이 포크의 빌드 안내는 Windows x64를 기준으로 합니다. Git, PowerShell 7 이상, Node.js 24 이상, Python 3.14 이상, uv 0.12.13 이상이 필요합니다.

PowerShell 7에서 저장소를 받은 뒤 저장소 루트에서 실행합니다.

```powershell
git clone --branch korean-0.46.1 https://github.com/Ultorr/peach_ko peach-korean
Set-Location peach-korean
pwsh -NoProfile -File ./scripts/build_korean.ps1
```

빌드가 끝나면 별도 데이터 폴더를 사용하는 로컬 초기 설정 서버를 실행합니다.

```powershell
$env:PEACH_DATA_ROOT = Join-Path (Get-Location).Path 'runtime/korean-smoke-data'
& ./.venv/Scripts/python.exe -X utf8 -m peach serve --setup --host 127.0.0.1 --port 8910 --no-mdns --no-ledger-sync
```

브라우저에서 `http://127.0.0.1:8910`을 열고 자신의 미디어 폴더를 지정합니다. 이 예시를 따를 때에는 고급 설정에서 접근 범위를 **이 컴퓨터만**, 포트를 **8910**으로 맞춥니다. 설정을 마치면 터미널에서 `Ctrl+C`로 종료한 뒤, 같은 터미널에서 `--setup`을 뺀 명령으로 실행합니다.

```powershell
& ./.venv/Scripts/python.exe -X utf8 -m peach serve --host 127.0.0.1 --port 8910 --no-mdns --no-ledger-sync
```

이 예시는 현재 기기에서만 접속하는 로컬 실행입니다. 빌드 과정은 개인 데이터, 기존 설치본이나 기존 설정을 가져오지 않습니다. FFmpeg, ffprobe, untrunc, cloudflared 등의 별도 도구와 선택적 로컬 패키징은 [빌드 안내](docs/BUILD_KO.md)를 따르세요.

원본의 운영·기능 설명은 [운영 문서](docs/OPERATIONS.md), [중문 README](README.zh-CN.md), [영문 README](README.en.md)에 있습니다. 원본 프로젝트의 릴리스와 업데이트 채널은 이 한국어판의 배포 채널과 구분해야 합니다. 원본 버전으로 업데이트하면 한국어 수정이 유지되지 않을 수 있습니다.

## 문제 제보

한국어 번역이나 이 포크의 변경으로 발생한 문제는 [이 포크의 Issues](https://github.com/Ultorr/peach_ko/issues)에 버전, 재현 순서와 기대 동작을 적어 주세요. 개인 미디어, 데이터베이스, 인증 정보, 전체 로그와 사용자 경로는 첨부하지 마세요.

## 저작권과 라이선스

Copyright (C) 2026 longmeidao. 원본 코드·자산과 저작권 고지는 유지됩니다. 이 한국어 수정본은 [GNU Affero General Public License v3 또는 그 이후 버전](LICENSE)에 따라 재배포·수정할 수 있으며, 라이선스에서 정한 범위의 무보증 조건이 적용됩니다.

제3자 구성요소의 개별 라이선스와 출처는 그대로 유지됩니다. [라이선스 안내](LOCALIZATION_LICENSE.md)와 [원본의 재사용 목록](docs/REUSE.md)을 확인하세요. 저장소의 Peach 로고와 기본 UI 자산은 원본 프로젝트의 자산이며 사용자 미디어가 아닙니다.

# 한국어 소스 실행과 Windows 빌드

이 문서는 Peach 0.46.1 한국어 수정본(`ko-KR-1`)을 저장소에서 직접 실행하거나 Windows 프로그램 디렉터리로 만드는 절차입니다. 원본 Peach 설치본, 개인 백업, 사용자 데이터, Sentry DSN은 필요하지 않습니다. 빌드 스크립트는 앱을 실행하거나 설치된 프로그램을 교체하지 않습니다.

## 준비 환경

- Windows x64, PowerShell 7 이상
- Node.js 24 이상과 함께 제공되는 npm
- uv 0.12.13 이상
- Python 3.14: `uv sync --python 3.14`가 호환 인터프리터를 선택하며, 없다면 uv 설정에 따라 내려받습니다.
- Git: clone과 빌드의 소스 커밋 기록에 사용합니다. 소스 ZIP에서는 커밋 정보가 `null`일 수 있습니다.
- 최초 준비 시 Python/npm 패키지를 내려받을 네트워크 연결

Python 및 uv 최소 요구는 [pyproject.toml](../pyproject.toml)의 `requires-python`과 `[tool.uv].required-version`, Node.js 최소 요구는 [frontend/package.json](../frontend/package.json)의 `engines.node`에 따릅니다.

[한국어 포크](https://github.com/Ultorr/peach_ko)의 공개 브랜치를 받습니다.

```powershell
git clone --branch korean-0.46.1 --single-branch https://github.com/Ultorr/peach_ko.git
Set-Location peach_ko
```

이후 명령은 **clone한 저장소 루트**에서 PowerShell로 실행합니다. 저장소의 `.venv`는 이 소스 전용입니다. 이 환경으로 이미 서버를 실행 중이라면 종료한 뒤 의존성을 다시 설치하세요.

## 소스 실행 준비

```powershell
pwsh -NoProfile -File ./scripts/build_korean.ps1
```

이 명령은 다음 작업을 수행합니다.

1. `uv.lock`에 맞춰 Python 3.14 환경과 모든 선택 의존성을 설치합니다. `build` 선택 항목에 `pyinstaller==6.22.3`이 선언되어 있으므로 별도 전역 PyInstaller 설치는 필요하지 않습니다.
2. 루트 `package-lock.json`으로 vendor 확인용 npm 의존성을 설치하고, 저장소의 `web/vendor` 자산을 검사합니다.
3. `frontend/package-lock.json`으로 프런트엔드 의존성을 설치하고 TypeScript 검사와 Vite 빌드를 실행합니다.

`web/dist`에는 `peach-app.js`, `peach-app.css`, `peach-pages.js`, `peach-pages.css`가 생성됩니다. `web/vendor`와 해당 라이선스·출처 파일은 저장소에 포함됩니다. vendor 검사에 실패하면 아래 명령으로 고정 의존성 자산을 다시 생성하고 변경 내용을 검토한 후 준비 명령을 재실행합니다.

```powershell
npm run vendor:web
git diff --stat
```

## 별도 데이터로 소스 실행

처음 확인할 때는 전용 데이터 폴더와 사용하지 않는 포트를 사용합니다. 다음 예는 저장소의 Git 제외 경로인 `runtime/korean-smoke-data`를 사용합니다. 최초 설정 화면에서는 테스트용 빈 미디어 폴더를 선택할 수 있습니다.

```powershell
$env:PEACH_DATA_ROOT = Join-Path (Get-Location).Path 'runtime/korean-smoke-data'
& ./.venv/Scripts/python.exe -X utf8 -m peach serve --setup --host 127.0.0.1 --port 8910 --no-mdns --no-ledger-sync
```

브라우저에서 `http://127.0.0.1:8910/`을 열어 최초 설정을 완료합니다. 이 예시에서는 고급 설정의 접근 범위를 **이 컴퓨터만**, 포트를 **8910**으로 지정합니다. 설정을 마치면 터미널에서 `Ctrl+C`로 종료하고, 같은 PowerShell에서 일반 서비스를 시작합니다.

```powershell
& ./.venv/Scripts/python.exe -X utf8 -m peach serve --host 127.0.0.1 --port 8910 --no-mdns --no-ledger-sync
```

상태 확인은 다른 PowerShell에서 다음과 같이 실행합니다. 이 명령은 앱 데이터를 수정하지 않습니다.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8910/healthz'
Invoke-RestMethod 'http://127.0.0.1:8910/healthz?ready=1'
```

일반 서비스의 준비 검사에는 최초 설정 완료와 정상 데이터베이스가 필요합니다. 이 소스 실행 예는 로컬 HTTP 서비스이며, 원본의 TLS 트레이 배포 설정과 구분됩니다. 종료는 서버 터미널의 `Ctrl+C`로 합니다. 작업을 마친 셸에서 환경변수 지정도 해제하려면 `Remove-Item Env:PEACH_DATA_ROOT`를 실행합니다.

## Windows 프로그램 디렉터리 생성

아래 선택적 패키징 경로는 공개용 빌드 스크립트의 문법과 원본 패키징 옵션을 대조했습니다. 이번 소스 공개에서는 새 실행 파일의 패키징·배포 검증까지 수행하지 않았습니다. 실제 확인한 범위는 기본 빌드와 소스 실행입니다.

```powershell
pwsh -NoProfile -File ./scripts/build_korean.ps1 -Package
```

동일한 의존성·웹 검증을 마친 후 `dist/Peach/Peach.exe`와 `dist/Peach/_internal`을 생성합니다. 출력 위치는 저장소 안으로 고정되어 있으며, 같은 출력 폴더로 다시 빌드하면 이전 빌드가 교체됩니다. 이 폴더를 실제 앱 데이터나 원본 설치 경로로 사용하지 마세요.

패키징 옵션은 `scripts/build_windows.ps1`의 PyInstaller `--onedir` 설정을 따릅니다. `standalone.txt`, 전체 `web` 자산과 vendor 라이선스, `migrations`, `resources`를 포함합니다. 앱 실행에는 `Peach.exe`와 `_internal`을 함께 유지해야 합니다. 설치 프로그램이나 단일 EXE 배포 파일은 생성하지 않습니다.

`_internal/build-info.json`에는 소스의 버전 `0.46.1`, Git 커밋, 수정 파일 여부(`source_dirty`), 빌드 시각, `locale=ko-KR`, `local_patch=ko-KR-1`이 기록됩니다. 미커밋 수정이 있으면 커밋만으로 같은 소스를 재현할 수 없으므로 공개 배포용 빌드는 변경 사항을 커밋한 상태에서 수행하세요. 잠금 파일로 의존성을 고정하지만 빌드 시각과 도구 환경 때문에 바이너리 해시까지 동일함을 보장하지는 않습니다.

`_internal/sentry.json`의 `dsn`과 `library_dsn`은 빈 문자열로 생성됩니다. 빌드하는 셸의 DSN 환경변수나 기존 설치의 설정을 가져오지 않습니다. 앱의 기타 외부 통신 설정은 소스에서 정의한 동작을 따릅니다.

패키지는 자동 실행되지 않습니다. 수동 첫 실행 시 기본 데이터 위치는 `%LOCALAPPDATA%/Peach/peach-data`입니다. 기존 설치와 분리해서 확인하려면 실행 **전에** 별도 `PEACH_DATA_ROOT`를 지정하거나 `Peach.exe --data-root <별도 절대경로>`를 사용하고, 사용 중인 서비스와 포트가 겹치지 않게 설정하세요. 사용자 데이터 폴더와 설치 폴더는 별도로 유지합니다.

## 별도 설치하는 외부 도구

이 스크립트는 FFmpeg, ffprobe, untrunc, cloudflared를 내려받거나 패키지에 포함하지 않습니다. 따라서 이 도구에 의존하는 미디어 탐색·추출·변환·MP4 복구·터널 기능에는 별도 설치가 필요합니다.

- FFmpeg와 ffprobe: 실행 파일을 `PATH`에 두거나 각각 `PEACH_FFMPEG`, `PEACH_FFPROBE`에 절대경로를 지정합니다. Peach 데이터 폴더의 `tools/ffmpeg/bin`도 지원합니다.
- untrunc: 필요할 때 별도 설치하고 `PEACH_UNTRUNC`에 절대경로를 지정할 수 있습니다.
- cloudflared: 공개 터널 기능이 필요할 때 별도 설치하고 `PEACH_CLOUDFLARED` 또는 설정의 `tunnel.binary`에 경로를 지정합니다.

FFmpeg와 관련 코덱은 빌드 구성에 따라 적용 라이선스가 달라지며, untrunc와 cloudflared도 독립된 라이선스를 갖습니다. 한국어 수정본의 AGPL 표시는 이러한 도구나 vendor 자산의 라이선스를 대체하지 않습니다. 도구를 묶어서 재배포하려면 각 도구의 해당 버전 라이선스와 소스 제공 조건을 별도로 확인하세요. 자세한 고지는 [LOCALIZATION_LICENSE.md](../LOCALIZATION_LICENSE.md)와 원본 [REUSE.md](REUSE.md)를 참고하세요.

원본 `build_windows.ps1 -Standalone`은 도구 및 대응 소스 ZIP, cloudflared 해시를 검증하는 완전한 배포 절차입니다. 위 스크립트는 외부 도구를 포함하지 않는 앱 빌드에 맞춰 그 PyInstaller 옵션을 사용합니다. 기존 설치의 파일을 복사하지 않습니다.

## 확인 범위

스크립트가 완료되면 잠금 파일 설치, vendor 동기화, TypeScript 검사, 프런트엔드 빌드가 통과한 상태입니다. `-Package` 성공은 추가로 PyInstaller 패키징이 완료되었음을 뜻합니다. 이는 전체 앱 기능 시험을 대신하지 않습니다. 실제 배포 전에는 별도 데이터로 앱을 실행하고 `/healthz?ready=1`, 주요 한국어 화면, 사용할 외부 도구 기능을 확인하세요. 저장소의 정식 테스트 절차는 [TESTING.md](TESTING.md)에 있습니다.

`scripts/smoke_desktop.py`는 외부 도구가 포함된 원본 배포 패키지용이므로 이 앱 전용 산출물에 그대로 적용하지 않습니다. 또한 최초 트레이 설정에서 기본 포트 8900을 사용하므로 기존 서비스와 동시에 실행할 때 포트 충돌을 확인해야 합니다.

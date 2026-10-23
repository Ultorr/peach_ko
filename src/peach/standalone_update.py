"""独立 Windows 包的持久更新事务：下载准备、用户重启、目录切换与回滚。"""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import zipfile

import httpx
from filelock import FileLock, Timeout

from . import __version__, desktop_installer, distribution, release_updates, settings_file, update_packages
from .fsutil import atomic_write_text
from .windows_update import replace_with_retry
from . import update_tasks

ACTIVE = {"downloading", "verifying", "extracting", "preparing", "restarting", "installing"}
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024


def state_path() -> Path:
    return settings_file.load_config().directory("state") / "standalone-update.json"


def remember_installation_data_root(config) -> bool:
    """在线安装启动时，将已知的数据目录记入空的默认启动落点。"""
    if not distribution.standalone() or not config.present:
        return False
    data = read()
    target = data.get("target")
    if (data.get("state") != "installing" or data.get("version") != __version__
            or not isinstance(target, str) or not Path(target).is_absolute()
            or Path(target).resolve() != Path(sys.executable).resolve().parent):
        return False
    bootstrap = distribution.user_data_root(os.environ)
    if (bootstrap.resolve() == config.data_root.resolve()
            or any((bootstrap / name).exists() for name in (
                settings_file.SETTINGS_FILENAME, "state/data-root.txt", "database/ledger.db"))):
        return False
    settings_file.remember_data_root(settings_file.load_config(
        environ=dict(os.environ, PEACH_DATA_ROOT=str(bootstrap))), config)
    return True


def read() -> dict:
    try:
        return json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"state": "idle", "progress": 0}


def write(data: dict, **changes) -> dict:
    data.update(changes, updated_at=time.time())
    atomic_write_text(state_path(), json.dumps(data, ensure_ascii=False))
    return data


def public() -> dict:
    data = read()
    if data.get("state") in ACTIVE and time.time() - data.get("updated_at", 0) > 180:
        data = dict(data, state="error", message="업데이트 작업이 중단되었습니다. 다시 시도하세요.")
    return {key: value for key, value in data.items() if key in {
        "state", "progress", "message", "downloaded", "total", "version", "updated_at"}}


def extract(archive: Path, destination: Path, progress, *, tool_files: set[str] | None = None) -> Path:
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if sum(item.file_size for item in entries) > MAX_EXPANDED or len(entries) > 20000:
            raise ValueError("업데이트 패키지의 압축 해제 용량이 제한을 초과합니다")
        seen = set()
        for index, item in enumerate(entries):
            name = item.filename
            parts = PurePosixPath(name).parts
            if (not parts or parts[0] != "Peach" or "\\" in name or ":" in name
                    or ".." in parts or name.startswith("/") or (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("업데이트에 유효하지 않은 경로가 포함되어 있습니다")
            if tool_files is not None and (item.is_dir() or "/".join(parts[1:]) not in tool_files):
                raise ValueError("도구 패키지에 목록에 없는 파일이 포함되어 있습니다")
            target = destination.joinpath(*parts).resolve()
            key = str(target).casefold()
            if not target.is_relative_to(destination) or key in seen:
                raise ValueError("업데이트 패키지 경로가 중복되거나 허용 범위를 벗어납니다")
            seen.add(key)
            package.extract(item, destination)
            progress(index + 1, len(entries))
    root = destination / "Peach"
    if tool_files is None and (not (root / "Peach.exe").is_file() or not (root / "_internal" / "standalone.txt").is_file()):
        raise ValueError("업데이트 패키지가 독립 Windows 버전이 아닙니다")
    return root


def download(url: str, archive: Path, size: int, digest: str, progress) -> None:
    checksum = hashlib.sha256()
    received = 0
    with httpx.Client(follow_redirects=True, timeout=30) as client, client.stream("GET", url) as response:
        response.raise_for_status()
        with archive.open("wb") as output:
            for chunk in response.iter_bytes(256 * 1024):
                received += len(chunk)
                if received > size:
                    raise ValueError("다운로드 크기가 릴리스 정보와 일치하지 않습니다")
                output.write(chunk)
                checksum.update(chunk)
                progress(received)
    if received != size or checksum.hexdigest() != digest:
        raise ValueError("업데이트 패키지 검증에 실패했습니다. 다시 다운로드하세요")


def prepare_tools(stage: Path, target: Path, transaction: Path, release: dict, data: dict,
                  *, report=None, fetch=None) -> None:
    report, fetch = report or write, fetch or download
    manifest = update_packages.read_manifest(stage, release["latest_version"])
    missing = []
    for tool, bundle in manifest["tools"].items():
        if update_packages.matches(stage, bundle["files"]):
            continue
        if update_packages.matches(target, bundle["files"]):
            for name in bundle["files"]:
                destination = update_packages.checked_path(stage, name)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(update_packages.checked_path(target, name), destination)
        else:
            missing.append((tool, bundle))
    total = data["total"] + sum(bundle["asset"]["size"] for _, bundle in missing)
    report(data, total=total)
    for index, (tool, bundle) in enumerate(missing):
        asset = bundle["asset"]
        archive = transaction / f"tools-{tool}.zip"
        received = data["downloaded"]
        report(data, state="downloading", message=f"{tool} 도구 패키지 다운로드 중")
        fetch(release["asset_url"].rsplit("/", 1)[0] + "/" + asset["name"], archive,
                 asset["size"], asset["sha256"],
                 lambda count, start=received, step=index, size=asset["size"]: report(
                     data, downloaded=start + count, progress=75 + round((step + count / size) / len(missing) * 13)))
        report(data, state="verifying", message=f"{tool} 도구 패키지 검증 중")
        extracted = extract(archive, transaction / f"tool-{tool}", lambda *_: None, tool_files=set(bundle["files"]))
        if not update_packages.matches(extracted, bundle["files"]):
            raise ValueError(f"{tool} 도구 패키지 파일 검증 실패")
        for name in bundle["files"]:
            destination = update_packages.checked_path(stage, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(update_packages.checked_path(extracted, name), destination)
    for tool, bundle in manifest["tools"].items():
        if not update_packages.matches(stage, bundle["files"]):
            raise ValueError(f"기존 {tool} 도구 재사용 검증 실패")


def prepare(data: dict, lock: FileLock) -> None:
    try:
        release = release_updates.check()
        if release["state"] != "available":
            raise ValueError(release["message"])
        digest = release.get("asset_digest") or ""
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise ValueError("업데이트 패키지에 SHA-256 검증 정보가 없습니다")
        total = release.get("asset_size", 0)
        if not isinstance(total, int) or not 0 < total <= MAX_ARCHIVE:
            raise ValueError("업데이트 패키지 크기가 유효하지 않습니다")
        target = Path(sys.executable).resolve().parent
        if state_path().resolve().is_relative_to(target):
            raise ValueError("데이터 폴더가 프로그램 폴더 안에 있어 자동 교체할 수 없습니다")
        transaction = target.parent / f".{target.name}-update-{data['id']}"
        transaction.mkdir()
        write(data, transaction=str(transaction), target=str(target), version=release["latest_version"],
              total=total, downloaded=0, message="다운로드 중", state="downloading")
        archive = transaction / "package.zip"
        download(release["asset_url"], archive, total, digest[7:],
                 lambda count: write(data, downloaded=count, progress=round(count / total * 65, 1)))
        write(data, state="verifying", progress=66, message="검증 중")
        write(data, state="extracting", message="압축 해제 중")
        stage = extract(archive, transaction / "stage", lambda done, count: write(data, progress=67 + round(done / count * 8)))
        from .buildinfo import read_build_info
        info = read_build_info(stage / "_internal")
        if not info or info.version != release["latest_version"]:
            raise ValueError("패키지 내부 버전이 릴리스 버전과 일치하지 않습니다")
        if release.get("package_kind") == "update":
            write(data, state="preparing", message="설치된 도구 재사용 및 검증 중")
            prepare_tools(stage, target, transaction, release, data)
        write(data, state="preparing", progress=90, message="설치 준비 중")
        desktop_installer.carry_uninstaller(target, stage)
        # 助手从自己的目录运行，正式目录与暂存目录都不会被它的 DLL 句柄占用。
        helper = transaction / "helper"
        shutil.copytree(target, helper, ignore=shutil.ignore_patterns("*.log"))
        write(data, stage=str(stage), helper=str(helper), state="ready", progress=100,
              message="업데이트 준비가 완료되었습니다. 재시작 후 설치합니다.")
    except Exception as exc:
        write(data, state="error", message=str(exc), progress=0)
    finally:
        lock.release()


def start() -> dict:
    if not distribution.standalone() or sys.platform != "win32":
        raise ValueError("이 설치 방식은 독립 패키지 업데이트를 지원하지 않습니다")
    lock = FileLock(str(state_path()) + ".lock", thread_local=False)
    try:
        lock.acquire(timeout=0)
    except Timeout:
        return public()
    if public().get("state") in ACTIVE | {"ready"}:
        lock.release()
        return public()
    data = write({"id": uuid.uuid4().hex}, state="downloading", progress=0, message="GitHub 연결 중")
    threading.Thread(target=prepare, args=(data, lock), daemon=True, name="PeachPackageUpdate").start()
    return public()


def request_restart() -> dict:
    if not distribution.standalone() or sys.platform != "win32":
        raise ValueError("이 설치 방식은 독립 패키지 업데이트를 지원하지 않습니다")
    with FileLock(str(state_path()) + ".lock", timeout=0):
        data = read()
        if data.get("state") != "ready":
            raise ValueError("업데이트 준비가 아직 완료되지 않았습니다")
        db = settings_file.load_config().directory("database") / "ledger.db"
        token = update_tasks.reserve(db)
        try:
            write(data, state="restarting", task_token=token, progress=0, message="작업 진행 상태를 저장하고 있습니다. 이후 재시작하여 설치합니다")
        except Exception:
            update_tasks.release(db, token)
            raise
    return public()


def poll(tray) -> None:
    if not distribution.standalone() or read().get("state") != "restarting":
        return
    if not tray._action_lock.acquire(blocking=False):
        return
    try:
        data = read()
        db = settings_file.load_config().directory("database") / "ledger.db"
        token = data.get("task_token") or update_tasks.reserve(db)
        if not data.get("task_token"):
            write(data, task_token=token)
        update_tasks.wait_quiescent(db)
        helper = Path(data["helper"]) / "Peach.exe"
        environment = os.environ.copy()
        environment["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        environment[settings_file.DATA_ROOT_ENV] = str(settings_file.load_config().data_root.resolve())
        process = subprocess.Popen([str(helper), "--apply-standalone-update", str(state_path()), str(os.getpid())],
                         cwd=str(helper.parent), env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        update_tasks.transfer(db, token, process.pid)
        tray.exit(reason="standalone-update")
    except Exception as exc:
        if 'token' in locals():
            update_tasks.release(db, token)
        write(read(), state="error", message=f"다시 시작하지 못했습니다: {exc}")
    finally:
        tray._action_lock.release()


def migrate_database(stage: Path, data: dict) -> Path | None:
    from .migrations import plan, sqlite_backup
    config = settings_file.load_config()
    database = config.directory("database") / "ledger.db"
    if not database.is_file():
        return None
    _, pending = plan(database, stage / "_internal" / "migrations")
    if not pending:
        return None
    backup = config.directory("state") / "update-backups" / data["id"] / "ledger.db"
    sqlite_backup(database, backup)
    write(data, database_backup=str(backup), state="installing", progress=10, message="로컬 데이터베이스 업데이트 중")
    environment = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT="1", PEACH_DATA_ROOT=str(config.data_root.resolve()))
    with (backup.parent / "migration.log").open("wb") as log:
        result = subprocess.run([str(stage / "Peach.exe"), "migrate", "upgrade", "--yes", "--db", str(database)],
                                cwd=str(stage), env=environment, stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                                timeout=180, check=False, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise RuntimeError("데이터베이스 업데이트 실패")
    return backup


def restore_database(data: dict) -> None:
    config = settings_file.load_config()
    database = config.directory("database") / "ledger.db"
    backup = config.directory("state") / "update-backups" / data["id"] / "ledger.db"
    if not backup.is_file():
        return
    with closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)) as source, closing(sqlite3.connect(database)) as destination:
        source.backup(destination)
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("데이터베이스 복원 확인 실패")


def _transaction_paths(manifest: Path):
    """只接受本机状态文件与同卷暂存目录，安装目标须为完整独立包。"""
    if manifest.resolve() != state_path().resolve():
        raise ValueError('업데이트 상태 파일이 일치하지 않습니다')
    data = read()
    target = Path(data["target"]).resolve()
    transaction = Path(data["transaction"]).resolve()
    stage = Path(data["stage"]).resolve()
    if (transaction.parent != target.parent or transaction.name != f".{target.name}-update-{data['id']}"
            or stage != transaction / "stage" / "Peach" or state_path().resolve().is_relative_to(target)
            or not (target / "_internal" / "standalone.txt").is_file()):
        raise ValueError('업데이트 폴더가 유효하지 않습니다')
    return data, target, transaction, stage


def apply(manifest: Path, wait_pid: int) -> int:
    """复制出来的助手等待原托盘正常退出，再在同一卷上切换两个目录。"""
    from .windows_restart import process_alive, start_tray, find_tray_windows, post_stop
    from .tray import configured_service_specs
    from .settings_file import load_config
    from . import job_recovery
    try:
        data, target, transaction, stage = _transaction_paths(manifest)
    except ValueError:
        return 2
    backup = transaction / "backup"
    moved = False
    installed = False
    db = load_config().directory("database") / "ledger.db"
    token = data.get("task_token")
    previous = job_recovery.legacy_library_request(db)
    try:
        if token:
            update_tasks.transfer(db, token, os.getpid())
        else:
            token = update_tasks.reserve(db)
    except Exception as exc:
        write(data, state="error", progress=0, message=f"설치 사전 검사에 실패하여 프로그램과 데이터베이스를 변경하지 않았습니다: {exc}")
        return 1
    try:
        deadline = time.monotonic() + 90
        while process_alive(wait_pid):
            if time.monotonic() > deadline:
                raise TimeoutError("트레이가 종료되지 않아 설치를 취소했습니다")
            time.sleep(.25)
        job_recovery.import_legacy_library(db, previous)
        migrate_database(stage, data)
        write(data, state="installing", progress=20, message="이전 버전 보관 중")
        replace_with_retry(target, backup)
        moved = True
        write(data, progress=50, message="새 버전 설치 중")
        replace_with_retry(stage, target)
        installed = True
        write(data, progress=80, message="새 버전 시작 중")
        update_tasks.release(db, token)
        start_tray(target / "Peach.exe")
        deadline = time.monotonic() + 90
        specs = configured_service_specs(load_config())
        spec = next((s for s in specs if s.name == "https"), specs[0])
        while time.monotonic() < deadline:
            try:
                health = httpx.get(spec.health_url, verify=spec.verify, trust_env=False, timeout=3)
                ready = httpx.get(spec.health_url + "?ready=1", verify=spec.verify, trust_env=False, timeout=3)
                if (health.status_code == ready.status_code == 200 and health.json().get("version") == data["version"]
                        and ready.json().get("ready") and find_tray_windows(target / "Peach.exe")):
                    if desktop_installer.installed(target):
                        try:
                            desktop_installer.record_version(data["version"])
                        except OSError:
                            pass
                    write(data, state="complete", progress=100, message=f"{data['version']} 버전으로 업데이트했습니다")
                    return 0
            except (httpx.HTTPError, ValueError):
                pass
            time.sleep(1)
        raise TimeoutError("새 버전이 실행 준비를 완료하지 못했습니다")
    except Exception as exc:
        if moved:
            from .error_reporting import event
            event('standalone-update-install', exc)
            try:
                if installed:
                    for window in find_tray_windows(target / "Peach.exe"):
                        post_stop(window.handle)
                    replace_with_retry(target, transaction / "failed")
                replace_with_retry(backup, target)
                restore_database(data)
                update_tasks.release(db, token)
                start_tray(target / "Peach.exe")
                message = f"업데이트에 실패하여 이전 버전으로 복원했습니다: {exc}"
            except Exception as rollback:
                event('standalone-update-rollback', rollback)
                message = f"업데이트에 실패했으며 되돌리기가 완료되지 않았습니다: {rollback}"
        else:
            from .error_reporting import event
            event('standalone-update-install', exc)
            message = f"업데이트를 설치하지 않았습니다: {exc}"
            try:
                restore_database(data)
                if token:
                    update_tasks.release(db, token)
                if not process_alive(wait_pid):
                    start_tray(target / "Peach.exe")
            except Exception as rollback:
                event('standalone-update-rollback', rollback)
                message = f"업데이트에 실패했으며 데이터베이스 복원이 완료되지 않았습니다: {rollback}"
        write(data, state="error", progress=0, message=message)
        return 1
    finally:
        if token:
            update_tasks.release(db, token)

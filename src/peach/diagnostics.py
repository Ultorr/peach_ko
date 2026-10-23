"""CLI 与 API 共用的分项诊断；不修复账本、配置、工具或挂载。"""
from __future__ import annotations

import ipaddress
import os
import platform
import shutil
import socket
import sqlite3
import sys
import tempfile
import time
from contextlib import closing

from . import __version__, access, distribution, settings_file
from .ffmpeg import FFmpegResolver, binary_diagnostics
from .health import inspect_database
from .mount_reachability import MountReachability, PROBE_TIMEOUT


def item(label, status, reason, *, action="", target=None, details=None):
    return {"label": label, "status": status, "reason": reason, "action": action,
            "target": target, "details": details or {}}


def doctor_endpoint(config):
    """选择配置端口或具有 TLS 材料的源码托盘入口。"""
    configured = (config.server.host, config.server.port)
    if distribution.standalone():
        return configured
    tls = config.directory("secrets") / "tls"
    if not all((tls / name).is_file() for name in ("peach-local-ca.crt", "peach.crt", "peach.key")):
        return configured
    if sys.platform == "darwin":
        return "0.0.0.0", 8443
    from .mdns import lan_ipv4
    try:
        address = os.environ.get("PEACH_LAN_ADDRESS") or lan_ipv4()
    except (OSError, RuntimeError):
        address = "0.0.0.0"
    return address, 443


def configuration(config, configured, *, validate=True):
    try:
        if validate:
            settings_file.load_config(environ=dict(os.environ, PEACH_DATA_ROOT=str(config.data_root)))
        elif settings_file.error():
            raise settings_file.SettingsFileError("설정 파일을 읽을 수 없습니다")
    except settings_file.SettingsFileError:
        return item("설정", "failed", "설정 파일을 읽을 수 없습니다", action="이 컴퓨터에서 설정 파일을 수정하세요")
    if not configured:
        return item("설정", "failed", "초기 설정이 아직 완료되지 않았습니다", action="초기 설정을 완료하세요", target="/settings/library")
    return item("설정", "ok", "설정 파일을 읽을 수 있습니다")


def database_checks(settings):
    state = inspect_database(settings.db_path)
    reasons = {"missing": "기록 데이터베이스가 없습니다", "empty": "기록 데이터베이스가 아직 초기화되지 않았습니다", "unavailable": "기록 데이터베이스를 읽을 수 없습니다"}
    readable = state["database"] == "available" and state["readable"]
    database = item("데이터베이스", "ok" if readable else "failed",
                    "기록 데이터베이스를 읽을 수 있습니다" if readable else reasons.get(state["database"], "기록 데이터베이스 구조를 읽을 수 없습니다"),
                    action="" if readable else "로컬 기록 데이터베이스와 백업을 확인하세요", details={"state": state["database"]})
    schema_reasons = {"current": "마이그레이션 검증 통과", "pending": "적용 대기 중인 마이그레이션이 있습니다", "empty": "기록 데이터베이스가 아직 초기화되지 않았습니다",
                      "mismatch": "마이그레이션 기록이 현재 프로그램과 일치하지 않습니다", "unavailable": "마이그레이션 검증 결과를 확인하지 못했습니다"}
    current = state["schema"] == "current"
    schema = item("데이터베이스 마이그레이션", "ok" if current else "failed", schema_reasons[state["schema"]],
                  action="" if current else "이 컴퓨터에서 데이터베이스 마이그레이션과 백업을 확인하세요",
                  details={key: state[key] for key in ("schema", "version", "pending", "mismatched", "unknown_versions")})
    return database, schema


def tools(settings, *, inspect=True):
    resolver = FFmpegResolver(settings.ffmpeg_root)
    found = {}
    for name, choice in (("ffmpeg", resolver.ffmpeg()), ("ffprobe", resolver.ffprobe())):
        found[name] = (binary_diagnostics(choice, decoders=name == 'ffmpeg') if inspect else
                       {'available': choice is not None, 'source': choice.source if choice else None,
                        'path': str(choice.path) if choice else None})
    openssl = shutil.which("openssl")
    found["openssl"] = {"available": openssl is not None, "source": "path" if openssl else None,
                        "path": openssl}
    missing = [name for name, value in found.items() if not value["available"]]
    unavailable = [name for name in ('ffmpeg', 'ffprobe') if found[name]['available'] and not found[name].get('usable', True)]
    incomplete = found['ffmpeg'].get('usable') and not found['ffmpeg'].get('av1_software')
    problems = (["찾을 수 없음: " + "、".join(missing)] if missing else [])
    problems += (["실행할 수 없음: " + "、".join(unavailable)] if unavailable else [])
    problems += ['FFmpeg에 AV1 소프트웨어 디코더가 없습니다'] if incomplete else []
    return item("FFmpeg／OpenSSL", 'warning' if problems else 'ok',
                '；'.join(problems) or ('미디어 도구를 실행할 수 있으며 AV1 소프트웨어 디코더를 사용할 수 있습니다' if inspect else '도구 경로를 찾았습니다'),
                action='미디어 도구 업데이트' if problems else '', target='/settings/maintenance' if problems else None, details=found)


def security(settings):
    policy = access.load(settings.access_path)
    try:
        loopback = settings.host == "localhost" or ipaddress.ip_address(settings.host).is_loopback
    except ValueError:
        loopback = False
    protected = policy["mode"] == "password" or (policy["mode"] == "legacy" and bool(settings.token))
    exposed = not loopback or settings.tunnel_enabled
    if policy["mode"] == "locked":
        return item("접속 보안", "failed", "접속 비밀번호 설정을 읽을 수 없습니다", action="이 컴퓨터에서 접속 비밀번호 설정을 확인하세요")
    if exposed and not protected:
        return item("접속 보안", "warning", "로컬 네트워크 또는 공개 인터넷 접속에 비밀번호가 설정되지 않았습니다",
                    action="설정에서 접속 비밀번호를 활성화하세요", target="/settings/network", details={"exposed": True, "protected": False})
    return item("접속 보안", "ok", "접속 비밀번호가 활성화되어 있습니다" if protected else "이 컴퓨터에서만 접속을 허용합니다",
                details={"exposed": exposed, "protected": protected})


def media_mounts(snapshot):
    if not snapshot["sources"]:
        return item("미디어 마운트", "disabled", "설정된 로컬 소스가 없습니다")
    states = {"ok": "ok", "degraded": "warning", "checking": "unknown"}
    reason = "소스를 읽을 수 있습니다" if snapshot["state"] == "ok" else "；".join(snapshot["warnings"]) or "마운트 확인이 아직 완료되지 않았습니다"
    return item("미디어 마운트", states[snapshot["state"]], reason,
                action="미디어 폴더와 마운트 상태를 확인하세요" if snapshot["state"] != "ok" else "", target="/settings/library",
                details=snapshot)


def component_checks(settings, snapshot, *, config=None, validate_config=True, inspect_tools=True):
    config = config or settings_file.active()
    database, schema = database_checks(settings)
    checks = {"database": database, "schema": schema, "configured": configuration(config, settings.configured, validate=validate_config),
              "media_mounts": media_mounts(snapshot), "security": security(settings)}
    checks["ffmpeg"] = tools(settings, inspect=inspect_tools)
    return checks


def writable_root(root):
    try:
        with tempfile.TemporaryFile(dir=root, prefix=".peach-doctor-") as probe:
            probe.write(b"peach")
            probe.flush()
    except PermissionError:
        return item("데이터 폴더", "failed", "데이터 폴더에 쓰기 권한이 없습니다", action="데이터 폴더의 쓰기 권한을 수정하세요")
    except OSError:
        return item("데이터 폴더", "failed", "데이터 폴더에 쓸 수 없습니다", action="데이터 폴더와 여유 공간을 확인하세요")
    return item("데이터 폴더", "ok", "임시 파일 쓰기 및 정리 검사 통과")


def port_status(host, port):
    host = "127.0.0.1" if host == "localhost" else host
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return item("서비스 포트", "unknown", "수신 주소가 IP가 아니므로 포트 상태를 확인하지 못했습니다", details={"port": port})
    family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.bind((host, port))
    except OSError as error:
        import errno
        if error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) == 10048:
            return item("서비스 포트", "ok", "포트가 사용 중입니다", details={"port": port, "state": "in_use"})
        return item("서비스 포트", "unknown", "포트 상태를 확인하지 못했습니다", details={"port": port})
    return item("서비스 포트", "ok", "현재 포트를 사용할 수 있습니다", details={"port": port, "state": "available"})


def recent_failure(path):
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
            connection.execute("PRAGMA query_only=ON")
            row = connection.execute("SELECT id,finished_at FROM task_run WHERE status='failed' "
                                     "ORDER BY finished_at DESC,id DESC LIMIT 1").fetchone()
    except (sqlite3.Error, OSError):
        return item("백그라운드 작업", "unknown", "작업 실패 기록을 확인하지 못했습니다")
    if row is None:
        return item("백그라운드 작업", "ok", "기록된 작업 실패가 없습니다")
    # 不公开任务 error、参数或结果原文，它们可能包含凭据和媒体路径。
    moment = str(row[1] or "")
    safe_time = moment if len(moment) <= 32 and all(c in "0123456789-:+.TZ " for c in moment) else None
    return item("백그라운드 작업", "warning", "기록된 작업 실패가 있습니다", action="활동 페이지에서 실패한 작업을 확인하세요",
                target="/tasks", details={"id": row[0], "finished_at": safe_time})


def probe_mounts(roots):
    monitor = MountReachability(roots)
    deadline = time.monotonic() + PROBE_TIMEOUT + 1.5
    try:
        while True:
            monitor.tick()
            snapshot = monitor.summary()
            if all(row["state"] != "checking" for row in snapshot["sources"]) or time.monotonic() >= deadline:
                return snapshot
            time.sleep(0.05)
    finally:
        monitor.stop()


def report(settings, snapshot, *, config=None):
    from . import library_diagnostics
    config = config or settings_file.active()
    checks = component_checks(settings, snapshot, config=config)
    checks.update(data_root=writable_root(config.data_root), port=port_status(settings.host, settings.port),
                  tasks=recent_failure(settings.db_path),
                  version=item("버전", "ok", f"Peach {__version__} · Python {platform.python_version()}",
                               details={"peach": __version__, "python": platform.python_version()}))
    statuses = {check["status"] for check in checks.values()}
    state = "failed" if "failed" in statuses else "warning" if statuses & {"warning", "unknown"} else "ok"
    return {"version": __version__, "status": state, "checks": checks,
            "library": library_diagnostics.library(settings, config),
            "sources": library_diagnostics.sources(settings, config)}


def health_components(settings, snapshot):
    checks = component_checks(settings, snapshot, validate_config=False, inspect_tools=False)
    # 公开健康检查只保留分项原因；工具路径与详细修法由本机诊断提供。
    return {key: {name: value[name] for name in ("status", "reason")} for key, value in checks.items()}

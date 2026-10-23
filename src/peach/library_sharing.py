"""明确同意的馆藏与口味明细，与错误诊断使用独立接收项目。"""
from __future__ import annotations

import gzip
import io
import json
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

from . import __version__, remote_reporting
from .fsutil import atomic_write_text

SCHEMA = 4
MAX_BYTES = 18 * 1024 * 1024
MAX_RAW_BYTES = 100 * 1024 * 1024
FILENAME = "peach-library-taste.json.gz"
FIELDS = [
    "중복을 제거한 항목 번호, 평점, 좋아요, 싫어요, 시청 완료, 나중에 보기, 재생 횟수, 시청 비율, 직접 추가한 태그",
    "출연자, 크리에이터, 제작사, 시리즈, 직접 추가한 태그, 연대, 재생 시간별 즐겨찾기·좋아요·싫어요·시청 수·평점 분포(번호가 있는 항목과 없는 항목은 구분) 및 직접 즐겨찾기에 추가한 엔터티 이름",
    "라이브러리 파일 수, 번호가 있는 항목 수, 번호가 없는 항목 수",
    "Peach 버전, 필드 버전, UTC 기준 달력 주",
]
NOTICE = "익명 처리 후 라이브러리 및 각종 취향 세부 정보를 업로드합니다."


def _path(config):
    return config.directory("state") / "library-sharing.json"


def consent(config):
    value = remote_reporting._read(_path(config))
    return value if value.get("enabled") is True and value.get("schema") == SCHEMA else {}


def save_choice(config, enabled):
    """保存设置页或安装器的主动选择，不读取馆藏或初始化上传。"""
    if type(enabled) is not bool:
        raise ValueError("라이브러리 및 취향 업로드 옵션은 불리언 값이어야 합니다")
    value = {"enabled": enabled, "schema": SCHEMA, "revision": uuid.uuid4().hex,
             "selected_at": datetime.now(timezone.utc).isoformat()}
    atomic_write_text(_path(config), json.dumps(value))
    return snapshot(config)


def target():
    destination = remote_reporting.dsn("PEACH_LIBRARY_SENTRY_DSN", "library_dsn")
    diagnostic = remote_reporting.dsn()
    first, second = urlsplit(destination), urlsplit(diagnostic)
    if destination and diagnostic and (first.hostname, first.path) == (second.hostname, second.path):
        return ""
    return destination


def snapshot(config):
    attempt = remote_reporting._read(config.directory("state") / "library-sharing-attempt.json")
    return {"enabled": bool(consent(config)), "available": bool(target()),
            "schema": SCHEMA, "fields": FIELDS, "notice": NOTICE,
            "last_attempt": attempt if attempt.get("schema") == SCHEMA else {}}


def collect(contract):
    """在本机生成群体分析投影，不读取浏览历史或写入缓存。"""
    from .library_research import project
    with contract.read_connection() as connection:
        connection.execute("BEGIN")
        projection = project(connection)
    payload = {"schema": SCHEMA, "peach": __version__, "period": datetime.now(timezone.utc).strftime("%G-W%V"),
               **projection}
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(data) > MAX_RAW_BYTES:
        raise ValueError("라이브러리 및 취향 세부 정보가 100MiB를 초과하여 전송하지 않았습니다")
    return payload, data


def compressed(data):
    """使用无文件名和时间戳的 gzip 附件，保持全部 JSON 字段。"""
    wire = gzip.compress(data, mtime=0)
    if len(wire) > MAX_BYTES:
        raise ValueError("압축한 라이브러리 및 취향 세부 정보가 18MiB를 초과하여 전송하지 않았습니다")
    return wire


def valid_payload(payload):
    from .library_research import valid_projection
    if (not isinstance(payload, dict) or set(payload) != {"schema", "peach", "period", "library", "preferences", "coverage"}
            or payload["schema"] != SCHEMA or payload["peach"] != __version__
            or payload["period"] != datetime.now(timezone.utc).strftime("%G-W%V")
            or not isinstance(payload["library"], list) or not isinstance(payload["preferences"], dict)):
        return False
    return valid_projection(payload)


class Service:
    def __init__(self, config, contract):
        self.config, self.contract = config, contract
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._preview = None
        self._lock = threading.RLock()

    def preview(self):
        payload, data = collect(self.contract)
        size = len(compressed(data))
        token = uuid.uuid4().hex
        with self._lock:
            self._preview = token, time.monotonic() + 600
        return {"data": payload, "bytes": len(data), "compressed_bytes": size, "token": token, "schema": SCHEMA}

    def save(self, body):
        if type(body.get("enabled")) is not bool:
            raise ValueError("라이브러리 및 취향 업로드 옵션은 불리언 값이어야 합니다")
        with self._lock:
            if body["enabled"] and (not self._preview or body.get("preview_token") != self._preview[0]
                    or time.monotonic() > self._preview[1]
                    or body.get("consent") is not True or body.get("schema") != SCHEMA):
                raise ValueError("필드와 데이터 미리보기를 확인한 후 업로드에 명시적으로 동의하세요")
            save_choice(self.config, body["enabled"])
            self._preview = None
        self._wake.set()
        return snapshot(self.config)

    def _gate(self, revision, envelope):
        current = consent(self.config)
        if self._stop.is_set() or not current or current.get("revision") != revision:
            return False
        if len(envelope.items) != 2 or [item.type for item in envelope.items] != ["event", "attachment"]:
            return False
        attachment = envelope.items[1]
        if attachment.headers.get("filename") != FILENAME:
            return False
        data = attachment.payload.get_bytes()
        if len(data) > MAX_BYTES:
            return False
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as archive:
                raw = archive.read(MAX_RAW_BYTES + 1)
            if len(raw) > MAX_RAW_BYTES:
                return False
            payload = json.loads(raw)
            if not valid_payload(payload):
                return False
        except (ValueError, KeyError, TypeError, OSError, EOFError):
            return False
        event = envelope.items[0].get_event()
        for key in tuple(event):
            if key not in {"event_id", "timestamp", "platform"}:
                del event[key]
        event.update(message="Peach library and taste research", level="info",
                     tags={"purpose": "population-research", "schema": str(SCHEMA), "period": payload["period"]})
        for key in tuple(envelope.headers):
            if key not in {"event_id", "sent_at"}:
                del envelope.headers[key]
        return True

    def attempt(self):
        current, destination = consent(self.config), target()
        if not current or not destination or self._stop.is_set():
            return
        period = datetime.now(timezone.utc).strftime("%G-W%V")
        state = self.config.directory("state") / "library-sharing-attempt.json"
        from filelock import FileLock
        state.parent.mkdir(parents=True, exist_ok=True)
        with FileLock(str(state) + ".lock", timeout=.1):
            previous = remote_reporting._read(state)
            if previous.get("schema") == SCHEMA and previous.get("period") == period:
                return
            atomic_write_text(state, json.dumps({"schema": SCHEMA, "period": period, "status": "attempted"}))
        payload, data = collect(self.contract)
        data = compressed(data)
        from sentry_sdk.attachments import Attachment
        client = remote_reporting._new_client(destination, envelope_gate=lambda envelope: self._gate(current["revision"], envelope))
        try:
            client.capture_event({"message": "Peach library and taste research", "level": "info",
                                  "tags": {"purpose": "population-research", "schema": str(SCHEMA), "period": payload["period"]}},
                                 hint={"attachments": [Attachment(bytes=data, filename=FILENAME,
                                                                  content_type="application/gzip")]})
            client.flush(timeout=5)
        finally:
            client.close(timeout=0)

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        def run():
            while not self._stop.is_set():
                try:
                    self.attempt()
                except Exception as error:
                    # 分享失败不把数据或错误原文转交诊断通道。
                    try:
                        state = self.config.directory("state") / "library-sharing-attempt.json"
                        value = remote_reporting._read(state)
                        atomic_write_text(state, json.dumps({**value, "status": "failed", "reason": type(error).__name__}))
                    except OSError:
                        pass
                self._wake.wait(3600)
                self._wake.clear()
        self._thread = threading.Thread(target=run, name="PeachLibrarySharing", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=6)

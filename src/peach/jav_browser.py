"""浏览器 JAV 添加队列：按番号查磁力，交给现有云下载与入库链路。"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
import threading
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

from .catalog_rules import is_jav_code, normalise_code_key, release_code_from_text, same_release_code
from .config import PROJECT_ROOT
from .downloads import INGESTED, RESUBMITTABLE_STATES, submit_offline_download, parse_magnet
from .follow_secrets import CredentialError
from .feeds import scan_code
from .fsutil import atomic_write_text

LOGGER = logging.getLogger(__name__)
CREDENTIAL = "jav-browser"
ACTIVE = {"queued", "searching"}
MESSAGES = {
    "idle": "Peach에 추가", "queued": "마그넷 검색 대기 중", "searching": "마그넷 검색 중",
    "submitted": "클라우드 다운로드 중", "ingested": "라이브러리에 추가됨", "owned": "라이브러리에 이미 있는 항목입니다",
    "failed": "추가에 실패했습니다. 다시 시도할 수 있습니다", "no_match": "자동 다운로드 가능한 마그넷을 찾지 못했습니다. 다시 시도할 수 있습니다",
}


@lru_cache(maxsize=1)
def source_sites() -> list[dict]:
    payload = json.loads((PROJECT_ROOT / "web" / "integrations" / "jav-sites.json").read_text(encoding="utf-8"))
    sites = payload.get("sites")
    if payload.get("version") != 1 or not isinstance(sites, list) or not sites:
        raise ValueError("JAV 사이트 목록을 읽을 수 없습니다")
    ids, domains = set(), set()
    for site in sites:
        if (not isinstance(site, dict) or not site.get("id") or site["id"] in ids
                or not site.get("label") or not site.get("kind")
                or site.get("mode") not in {"automatic", "selection"}
                or not isinstance(site.get("domains"), list) or not site["domains"]):
            raise ValueError("JAV 사이트 목록에 유효하지 않은 항목이 있습니다")
        ids.add(site["id"])
        for host in site["domains"]:
            if not isinstance(host, str) or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host) or host in domains:
                raise ValueError("JAV 사이트 목록에 유효하지 않은 도메인이 있습니다")
            domains.add(host)
    return sites


def code_key(value: object) -> str:
    raw = str(value or "").strip()
    code = release_code_from_text(raw) if len(raw) <= 80 else None
    if not code or not is_jav_code(code) or normalise_code_key(raw) != normalise_code_key(code):
        raise ValueError("정확한 JAV 품번을 입력하세요")
    return normalise_code_key(code)


def source_page(value: object) -> str:
    raw = str(value or "")
    try:
        parsed = urlsplit(raw)
        host = (parsed.hostname or "").lower()
        site = next((site for site in source_sites() if any(
            host == name or host.endswith("." + name) for name in site["domains"])), None)
        if (len(raw) > 2048 or parsed.scheme != "https" or site is None or parsed.username
                or parsed.password or parsed.port not in {None, 443} or parsed.fragment):
            raise ValueError
        parameters = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=16)
        if (len({key for key, _value in parameters}) != len(parameters) or any(
                key not in site.get("query_keys", ()) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value)
                for key, value in parameters)):
            raise ValueError
    except ValueError:
        raise ValueError("지원하는 JAV 동영상 상세 페이지에서 추가하세요") from None
    return parsed._replace(query=urlencode(parameters), fragment="").geturl()


class JavBrowser:
    """本机持久队列；搜索完成前退出时，下一次启动继续处理。"""

    def __init__(self, contract, *, search):
        self.contract = contract
        self.downloads = contract.downloads
        self.credentials = self.downloads.credentials
        self.path = Path(contract.follow_state_root) / "jav-browser-queue.json"
        self.search = search
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None
        self.rows = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            return {}
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or len(payload) > 200:
            raise ValueError("브라우저 추가 대기열을 읽을 수 없습니다")
        for key, row in payload.items():
            if not isinstance(row, dict) or code_key(key) != key or row.get("state") not in MESSAGES:
                raise ValueError("브라우저 추가 대기열을 읽을 수 없습니다")
            if row["state"] == "searching":
                row["state"] = "queued"
        return payload

    def _save(self):
        atomic_write_text(self.path, json.dumps(self.rows, ensure_ascii=False, indent=2) + "\n")

    def _config(self) -> dict:
        credential = self.credentials.load(CREDENTIAL)
        return dict(credential.values) if credential else {}

    def settings(self) -> dict:
        config = self._config()
        providers = self.downloads.snapshot(1)["providers"] if self.downloads.available else []
        return {"enabled": bool(config.get("token_hash")), "provider": config.get("provider", "115"),
                "available": self.downloads.available, "providers": providers,
                "sites": [{key: site[key] for key in ("id", "label", "kind", "domains", "mode")}
                          for site in source_sites()]}

    def configure(self, body: dict) -> dict:
        action = body.get("action")
        if action not in {"enable", "rotate", "disable"}:
            raise ValueError("활성화, 토큰 갱신 또는 비활성화를 선택하세요")
        if not self.downloads.available:
            raise ValueError("브라우저 추가는 기록 데이터베이스 쓰기 담당 기기에서만 사용할 수 있습니다")
        with self._lock:
            if action == "disable":
                self.credentials.clear(CREDENTIAL)
                for row in self.rows.values():
                    if row["state"] in ACTIVE:
                        row.update(state="failed", message="브라우저 추가가 비활성화되었습니다")
                self._save()
                return self.settings()
            provider = str(body.get("provider") or "")
            self._ready(provider)
            token = secrets.token_urlsafe(32)
            self.credentials.save(CREDENTIAL, {
                "token_hash": hashlib.sha256(token.encode()).hexdigest(), "provider": provider})
            return {**self.settings(), "token": token}

    def authorized(self, supplied: str) -> bool:
        try:
            expected = self._config().get("token_hash", "")
        except CredentialError:
            return False
        return bool(expected and supplied and len(supplied) <= 256 and hmac.compare_digest(
            expected, hashlib.sha256(supplied.encode()).hexdigest()))

    def _ready(self, provider: str):
        if not self.downloads.available:
            raise ValueError("브라우저 추가는 기록 데이터베이스 쓰기 담당 기기에서만 사용할 수 있습니다")
        state = next((row for row in self.downloads.snapshot(1)["providers"] if row["key"] == provider), None)
        if not state or not state["configured"] or not state["target"]:
            raise ValueError("다운로드 채널에서 클라우드 계정과 대상 폴더를 먼저 설정하세요")

    def _existing(self, code: str) -> dict | None:
        with self.contract.database.read_connection() as connection:
            row = connection.execute(
                "SELECT id FROM asset WHERE normalise_code_key(code)=? AND medium='video' "
                "AND disposal IS NULL ORDER BY id LIMIT 1", (code,)).fetchone()
            if row:
                return {"state": "owned", "asset_id": row[0]}
            tasks = connection.execute(
                "SELECT id,state FROM download_task WHERE normalise_code_key(code)=? "
                "ORDER BY id DESC", (code,)).fetchall()
        for task in tasks:
            if task["state"] not in RESUBMITTABLE_STATES:
                return {"state": "ingested" if task["state"] == INGESTED else "submitted", "task_id": task["id"]}
        return None

    def status(self, value: object) -> dict:
        code = code_key(value)
        with self._lock:
            row = dict(self.rows.get(code, {}))
            task = self.downloads.store.get(row["task_id"]) if row.get("task_id") else None
            if task is not None:
                state = "ingested" if task.state == INGESTED else (
                    "failed" if task.state in RESUBMITTABLE_STATES or task.blocked_at else "submitted")
                row.update(state=state, message=task.failure_detail or MESSAGES[state])
                if task.asset_id:
                    row["asset_id"] = task.asset_id
            else:
                row.update(self._existing(code) or {})
            state = row.get("state", "idle")
            return {"ok": True, "code": code, **row, "state": state,
                    "message": row.get("message") or MESSAGES[state]}

    def add(self, body: dict) -> dict:
        code, page = code_key(body.get("code")), source_page(body.get("source_url"))
        with self._lock:
            config = self._config()
            if not config.get("token_hash"):
                raise ValueError("브라우저 추가를 먼저 활성화하세요")
            status = self.status(code)
            if status["state"] in ACTIVE | {"owned", "submitted", "ingested"}:
                return status
            self._ready(config.get("provider", ""))
            if code not in self.rows and len(self.rows) >= 200:
                completed = next((key for key, row in self.rows.items() if row["state"] not in ACTIVE), None)
                if completed is None:
                    raise ValueError("추가 대기열이 가득 찼습니다. 현재 작업이 끝날 때까지 기다리세요")
                del self.rows[completed]
            self.rows[code] = {"state": "queued", "provider": config["provider"], "source_url": page}
            self._save()
            self._wake.set()
            return self.status(code)

    def process_one(self) -> bool:
        with self._lock:
            if self._stop.is_set() or not self.downloads.available or not self._config().get("token_hash"):
                return False
            code = next((key for key, row in self.rows.items() if row["state"] == "queued"), None)
            if code is None:
                return False
            row = self.rows[code]
            existing = self._existing(code)
            if existing:
                row.update(existing)
                self._save()
                return True
            row["state"] = "searching"
            self._save()
            provider = row["provider"]
        try:
            self._ready(provider)
            result = self.search(self.contract, {"code": code, "goal": "quality"})
            candidate = None
            for item in result.get("items", ()):
                name = str(item.get("name") or "")
                if (not same_release_code(scan_code(name), code)
                        or re.search(r"(?i)\b(?:sample|trailer|preview)\b|予告|预告|預告", name)):
                    continue
                try:
                    parse_magnet(str(item.get("uri") or ""))
                except ValueError:
                    continue
                candidate = item
                break
            with self._lock:
                if row["state"] != "searching" or not self._config().get("token_hash"):
                    return True
                elif self._stop.is_set():
                    row["state"] = "queued"
                elif existing := self._existing(code):
                    row.update(existing)
                elif candidate is None:
                    failed = result.get("state") in {"error", "unavailable"} or bool(result.get("error"))
                    row.update(state="failed" if failed else "no_match", message=(
                        "현재 리소스 검색을 사용할 수 없습니다. Peach에서 소스를 확인한 후 다시 시도하세요" if failed else MESSAGES["no_match"]))
                else:
                    submitted = submit_offline_download(
                        self.downloads, magnet=candidate["uri"], provider=provider, code=code,
                        origin="browser:" + row["source_url"], dedupe_code=True)
                    task = submitted["task"]
                    row.update(state="failed" if submitted["outcome"] in {"failed", "refused"} else "submitted",
                               task_id=task["id"])
                self._save()
        except Exception as error:
            LOGGER.error("JAV 浏览器添加失败：%s (%s)", code, type(error).__name__)
            with self._lock:
                if row["state"] == "searching":
                    row.update(state="failed", message="검색 또는 클라우드 다운로드 제출에 실패했습니다. Peach에서 다운로드 채널을 확인한 후 다시 시도하세요")
                    self._save()
        return True

    def start(self):
        if not self.downloads.available or self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="PeachJavBrowser", daemon=True)
        self._thread.start()

    def _loop(self):
        while not self._stop.is_set():
            self._wake.clear()
            if not self.process_one():
                self._wake.wait(30)

    def stop(self):
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join()
            self._thread = None

"""用户自配 Torznab 索引器：有界请求、候选筛选与质量排序。

XML 模型由 torznab 解析；请求、凭据与番号判据由 Peach 管理。搜索只返回候选，
下载由用户逐条提交现有云下载入口。配置以一份本机凭据文件原子保存。

OneJAV 一类索引器只给种子文件、不给磁力与 infohash：这类条目经索引器自己的下载代理
取回种子，按 bencode2 解码后对 info 字典求 SHA-1，换成磁力候选。
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit
from xml.etree.ElementTree import ParseError, fromstring

import bencode2
import httpx
from torznab.exceptions import TorznabAPIError
from torznab.parser import parse_capabilities, parse_torznab

from .catalog_rules import jav_edition_badges, normalise_code_key, release_code_from_text, same_release_code
from .downloads import parse_magnet
from .follow_secrets import CredentialError, CredentialStore
from .feeds import scan_code

CREDENTIAL = "resource-indexers"
MAX_INDEXERS = 4
MAX_BYTES = 2 * 1024 * 1024
MAX_RESULTS = 5
MAX_ITEMS = 100
#: 每个索引器每轮最多取几份种子：只取番号、体积、做种都已对上的条目。
MAX_TORRENTS = 6
MAX_TORRENT_BYTES = 8 * 1024 * 1024


def endpoint(value: object) -> str:
    """API 地址不携带查询参数或凭据；允许用户部署在回环和局域网。"""
    text = str(value or "").strip()
    try:
        url = urlsplit(text)
        port = url.port
    except ValueError:
        raise ValueError("인덱서 주소 형식이 올바르지 않습니다") from None
    if (len(text) > 2048 or url.scheme not in ("http", "https") or not url.hostname
            or url.username is not None or url.password is not None or url.query or url.fragment
            or any(char.isspace() for char in text) or port == 0):
        raise ValueError("HTTP 또는 HTTPS API 주소를 입력하세요. API key는 별도로 입력하고 주소에 쿼리 매개변수를 포함하지 마세요")
    return text


class Indexers:
    def __init__(self, credentials: CredentialStore):
        self.credentials = credentials

    def load(self) -> list[dict]:
        try:
            credential = self.credentials.load(CREDENTIAL)
            rows = json.loads(credential.values.get("indexers", "[]")) if credential else []
            if not isinstance(rows, list) or len(rows) > MAX_INDEXERS:
                raise ValueError
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get("key"), str):
                    raise ValueError
                if not isinstance(row.get("name"), str) or type(row.get("enabled")) is not bool:
                    raise ValueError
                endpoint(row.get("url"))
            return rows
        except (CredentialError, ValueError, TypeError):
            raise ValueError("인덱서 설정을 읽을 수 없습니다. 이 컴퓨터의 ‘설정 → 다운로드’에서 다시 저장하세요") from None

    def public(self) -> dict:
        return {"indexers": [
            {name: row[name] for name in ("key", "name", "url", "enabled")}
            | {"api_key_set": bool(row.get("api_key"))}
            for row in self.load()], "max_indexers": MAX_INDEXERS}

    def save(self, body: dict) -> dict:
        rows = body.get("indexers") if isinstance(body, dict) else None
        if not isinstance(rows, list) or len(rows) > MAX_INDEXERS:
            raise ValueError(f"인덱서는 최대 {MAX_INDEXERS}개까지 설정할 수 있습니다")
        previous = {row["key"]: row for row in self.load()}
        saved: list[dict] = []
        keys: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("인덱서 설정은 객체여야 합니다")
            key = str(row.get("key") or "")
            name = str(row.get("name") or "").strip()
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,48}", key) or key in keys:
                raise ValueError("인덱서 번호가 비어 있거나 중복됩니다")
            if not name or len(name) > 80:
                raise ValueError("인덱서 이름은 1~80자여야 합니다")
            address = endpoint(row.get("url"))
            old = previous.get(key, {})
            secret = str(row.get("api_key") or "").strip()
            if not secret and not row.get("clear_api_key") and old.get("url") == address:
                secret = old.get("api_key", "")
            if len(secret) > 512 or any(char.isspace() for char in secret):
                raise ValueError("API key 형식이 올바르지 않습니다")
            saved.append(dict(key=key, name=name, url=address, api_key=secret,
                              enabled=row.get("enabled") is True))
            keys.add(key)
        self.credentials.save(CREDENTIAL, {"indexers": json.dumps(saved, ensure_ascii=False)})
        return self.public()


@dataclass(frozen=True)
class Filters:
    min_size: int = 0
    max_size: int = 1024 ** 4
    goal: str = "quality"

    def __post_init__(self):
        if not 0 <= self.min_size <= self.max_size <= 1024 ** 4:
            raise ValueError("크기 범위는 0~1TiB 사이여야 하며 최솟값이 최댓값보다 클 수 없습니다")
        if self.goal not in ("quality", "chinese", "uncensored"):
            raise ValueError("품질 목표는 고화질, 중국어 자막 또는 무수정만 선택할 수 있습니다")


def qualities(title: str, tags: list[str], code: str) -> dict:
    text = " ".join([title, *tags])
    resolution = next((value for pattern, value in (
        (r"(?i)(?<!\w)(?:4k|2160p|uhd)(?!\w)", 2160),
        (r"(?i)(?<!\w)(?:1080[pi]|fhd)(?!\w)", 1080),
        (r"(?i)(?<!\w)720p(?!\w)", 720)) if re.search(pattern, text)), 0)
    codec = next((value for pattern, value in (
        (r"(?i)\b(?:h[ ._-]?265|x265|hevc)\b", "HEVC"),
        (r"(?i)\b(?:h[ ._-]?264|x264|avc)\b", "AVC"),
        (r"(?i)\bav1\b", "AV1")) if re.search(pattern, text)), "")
    editions = jav_edition_badges(title, code, tags)
    return {"resolution": resolution, "codec": codec, "chinese": "中字" in editions,
            "uncensored": "无码" in editions or "无码破解" in editions}


def torrent_info_hash(data: bytes) -> str:
    """种子文件的 v1 infohash：info 字典编码后的 SHA-1。

    bencode2 拒收键乱序的字典，所以重新编码的字节就是原文，不会算出另一个哈希。
    """
    meta = bencode2.bdecode(data)
    info = meta.get(b"info") if isinstance(meta, dict) else None
    if not isinstance(info, dict):
        raise ValueError("토렌트 파일에 info 사전이 없습니다")
    return hashlib.sha1(bencode2.bencode(info)).hexdigest()


def candidate(item, indexer: dict, code: str, filters: Filters,
              fetch: Callable[[str], str | None] | None = None) -> dict | None:
    """`fetch` 把索引器给的种子下载地址换成 infohash；条目自带磁力或 infohash 时不调用。"""
    title = str(item.title or "")[:500]
    if not same_release_code(scan_code(title), code):
        return None
    if item.size is None or not filters.min_size <= item.size <= filters.max_size:
        return None
    if item.seeders is None or item.seeders <= 0:
        return None
    info_hash = None
    for raw in (item.magnet_url, item.link, item.guid, item.infohash):
        if raw:
            try:
                info_hash = parse_magnet(raw).info_hash
                break
            except ValueError:
                continue
    if info_hash is None and fetch and item.link:
        info_hash = fetch(item.link)
    if info_hash is None:
        return None
    # 候选只携带规范 hash，索引器返回的 tracker 与 URL 可能含私有 passkey。
    quality = qualities(title, item.tags, code)
    return {"id": info_hash, "info_hash": info_hash,
            "uri": f"magnet:?xt=urn:btih:{info_hash}", "name": title,
            "size": item.size, "seeders": item.seeders, "peers": item.peers,
            "date": str(item.pub_date or "")[:100], "source": indexer["name"],
            "origins": [indexer["name"]], **quality}


def _xml(client: httpx.Client, indexer: dict, params: dict, deadline: float) -> str:
    params = {**params, "apikey": indexer.get("api_key", "")}
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError("인덱서 조회 시간이 초과되었습니다")
    with client.stream("GET", indexer["url"], params=params, timeout=min(10, remaining)) as response:
        if response.status_code != 200:
            raise ValueError(f"인덱서가 HTTP {response.status_code}을(를) 반환했습니다")
        content = bytearray()
        for chunk in response.iter_bytes(chunk_size=16384):
            if time.monotonic() > deadline:
                raise ValueError("인덱서 조회 시간이 초과되었습니다")
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise ValueError("인덱서 응답이 2MiB를 초과합니다")
    text = bytes(content).decode("utf-8")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("인덱서 XML에 지원되지 않는 엔터티 선언이 있습니다")
    if fromstring(text).tag not in ("caps", "rss", "error"):
        raise ValueError("인덱서가 Torznab XML을 반환하지 않았습니다")
    return text


def _torrent_hash(client: httpx.Client, indexer: dict, link: str, deadline: float) -> str | None:
    """经索引器自己的下载代理取种子换 infohash；取不到只丢这一条，不算索引器失败。

    只请求与 API 地址同源的链接：Prowlarr、Jackett 的下载代理都在自己那台机器上，
    别处的地址不替索引器去访问。代理改回磁力的重定向直接取 Location。
    """
    api, target = urlsplit(indexer["url"]), urlsplit(link)
    try:
        same_origin = (api.scheme, api.hostname, api.port) == (target.scheme, target.hostname, target.port)
    except ValueError:
        return None
    remaining = deadline - time.monotonic()
    if not same_origin or remaining <= 0:
        return None
    try:
        with client.stream("GET", link, timeout=min(10, remaining)) as response:
            if response.is_redirect:
                return parse_magnet(response.headers.get("location", "")).info_hash
            if response.status_code != 200:
                return None
            content = bytearray()
            for chunk in response.iter_bytes(chunk_size=65536):
                content.extend(chunk)
                if len(content) > MAX_TORRENT_BYTES or time.monotonic() > deadline:
                    return None
        return torrent_info_hash(bytes(content))
    except (httpx.HTTPError, ValueError):
        return None


class Search:
    """一轮最多四个来源，每源两次查询、至多六份种子；同一进程串行并缓存一分钟。"""
    def __init__(self, *, transport=None, clock=time.monotonic):
        self.transport = transport
        self.clock = clock
        self.lock = threading.Lock()
        self.cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()

    def run(self, indexers: list[dict], code: str, filters: Filters, blocked=()) -> dict:
        code = normalise_code_key(code)
        if not code or len(code) > 80 or not same_release_code(release_code_from_text(code), code):
            raise ValueError("인식 가능한 항목 품번을 입력하세요")
        active = [row for row in indexers if row.get("enabled")]
        if len(active) > MAX_INDEXERS:
            raise ValueError("인덱서 수가 제한을 초과합니다")
        if not active:
            return {"ok": True, "state": "unavailable", "items": [], "warnings": [],
                    "error": "이 컴퓨터의 ‘설정 → 다운로드’에서 인덱서를 추가하고 활성화하세요"}
        if not self.lock.acquire(blocking=False):
            return {"ok": False, "state": "busy", "items": [], "warnings": [],
                    "error": "리소스 검색이 진행 중입니다. 잠시 후 다시 시도하세요"}
        try:
            key = (json.dumps(active, sort_keys=True), code, filters)
            cached = self.cache.get(key)
            if cached and self.clock() - cached[0] < 60:
                result = cached[1]
            else:
                result = self._search(active, code, filters)
                self.cache[key] = (self.clock(), result)
                self.cache.move_to_end(key)
                while len(self.cache) > 128:
                    self.cache.popitem(last=False)
            excluded = set(blocked)
            return {**result, "items": [row for row in result["items"]
                                        if row["info_hash"] not in excluded][:MAX_RESULTS]}
        finally:
            self.lock.release()

    def _search(self, indexers: list[dict], code: str, filters: Filters) -> dict:
        found: dict[str, dict] = {}
        warnings = []
        successful = 0
        deadline = time.monotonic() + 45
        query = code.split("-")[-1] if code.startswith("FC2-") else code
        with httpx.Client(transport=self.transport, follow_redirects=False, trust_env=False) as client:
            for indexer in indexers:
                try:
                    caps = parse_capabilities(_xml(client, indexer, {"t": "caps"}, deadline))
                    search = caps.searching.search if caps.searching else None
                    if not search or not search.available or "q" not in search.supported_params:
                        raise ValueError("인덱서가 품번 검색 기능을 지원한다고 명시하지 않았습니다")
                    limit = min(MAX_ITEMS, max(1, caps.limits.max or MAX_ITEMS)) if caps.limits else MAX_ITEMS
                    items = parse_torznab(_xml(client, indexer, {
                        "t": "search", "q": query, "cat": "6000", "limit": str(limit)}, deadline))
                    successful += 1
                    budget = [MAX_TORRENTS]

                    def fetch(link: str, indexer=indexer, budget=budget) -> str | None:
                        if budget[0] <= 0:
                            return None
                        budget[0] -= 1
                        return _torrent_hash(client, indexer, link, deadline)
                    for item in items[:MAX_ITEMS]:
                        row = candidate(item, indexer, code, filters, fetch)
                        if row is None:
                            continue
                        prior = found.get(row["info_hash"])
                        if prior:
                            prior["origins"] = sorted(set(prior["origins"] + row["origins"]))
                            prior["seeders"] = max(prior["seeders"], row["seeders"])
                        else:
                            found[row["info_hash"]] = row
                except (httpx.HTTPError, UnicodeError, ParseError, TorznabAPIError):
                    warnings.append(f"{indexer['name']}: 요청에 실패했거나 응답 형식이 올바르지 않습니다. 인덱서를 확인하세요")
                except ValueError as error:
                    warnings.append(f"{indexer['name']}：{error}")
        def rank(row):
            target = row[filters.goal] if filters.goal in ("chinese", "uncensored") else row["resolution"]
            return (-int(target), -row["resolution"], -row["seeders"], row["size"], row["info_hash"])
        return {"ok": successful > 0, "state": "ready" if successful else "error",
                "items": sorted(found.values(), key=rank), "warnings": warnings,
                "error": "" if successful else "모든 인덱서에서 검색을 완료하지 못했습니다"}

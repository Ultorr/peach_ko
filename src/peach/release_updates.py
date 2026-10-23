"""GitHub 测试版查询；传输复用共享 HTTPX，安装入口指向正式发行页。"""
from __future__ import annotations

import json
import re
import httpx

from . import __version__, distribution
from .http import HttpRequest, HttpxTransport
from .update_packages import TOOL_PATHS

RELEASES_URL = "https://github.com/peach-mitao/peach/releases"
API_URL = "https://api.github.com/repos/peach-mitao/peach/releases?per_page=100"


def snapshot() -> dict:
    return {"current_version": __version__, "latest_version": None,
            "channel": "테스트 버전", "installation": "独立测试包" if distribution.standalone() else "源码运行",
            "state": "unchecked", "message": "아직 확인하지 않음", "release_url": RELEASES_URL}


def _version(value: object) -> tuple[int, ...] | None:
    if not isinstance(value, str) or not re.fullmatch(r"v?\d+\.\d+\.\d+", value):
        return None
    return tuple(map(int, value.removeprefix("v").split(".")))


def check(*, transport=None) -> dict:
    result = snapshot()
    client = transport or HttpxTransport()
    try:
        response = client(HttpRequest("GET", API_URL, {"Accept": "application/vnd.github+json",
                          "X-GitHub-Api-Version": "2022-11-28"}), 12.0, 2_000_000)
        if response.status != 200:
            message = "GitHub 요청이 제한되었습니다. 잠시 후 다시 시도하세요." if response.status in (403, 429) else "GitHub에 연결할 수 없습니다. 다시 시도하세요."
            return dict(result, state="error", message=message)
        rows = json.loads(response.body)
        if not isinstance(rows, list):
            raise ValueError("release list required")
        releases = []
        for row in rows:
            if not isinstance(row, dict) or row.get("draft"):
                continue
            version = _version(row.get("tag_name"))
            if version is None:
                continue
            tag = row["tag_name"]
            assets = row.get("assets") or []
            prefix = f"Peach-{tag.removeprefix('v')}-windows-x64"
            uploaded = {a.get("name"): a for a in assets if isinstance(a, dict) and a.get("state") == "uploaded"}
            full = uploaded.get(prefix + ".zip")
            if full is None:
                continue
            complete_tools = all(prefix + f"-tools-{tool}.zip" in uploaded for tool in TOOL_PATHS)
            asset = uploaded.get(prefix + "-update.zip", full) if complete_tools else full
            releases.append((version, tag, asset, full))
        if not releases:
            return dict(result, state="empty", message="다운로드할 수 있는 테스트 버전이 없습니다.")
        version, tag, asset, full = max(releases, key=lambda item: item[0])
        current = _version(result["current_version"])
        if current is None:
            raise ValueError("current version required")
        state = "available" if version > current else "ahead" if version < current else "current"
        message = {"available": "새 버전을 다운로드할 수 있습니다.", "ahead": "현재 버전이 공개된 테스트 버전보다 최신입니다.", "current": "최신 테스트 버전입니다."}[state]
        return dict(result, latest_version=tag.removeprefix("v"), state=state, message=message,
                    asset_url=f"{RELEASES_URL}/download/{tag}/{asset['name']}",
                    asset_size=asset.get("size", 0), asset_digest=asset.get("digest"),
                    package_kind="update" if asset is not full else "full",
                    release_url=f"{RELEASES_URL}/tag/{tag}")
    except (OSError, ValueError, TypeError, TimeoutError, httpx.HTTPError):
        return dict(result, state="error", message="버전 정보를 가져오지 못했습니다. 다시 시도하세요.")
    finally:
        if transport is None:
            client.close()

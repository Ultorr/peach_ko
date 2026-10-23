"""采集来源共用的 Peach 连接策略与本机代理凭据。"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

from .follow_secrets import CredentialStore
from .fsutil import atomic_write_text


def values(root: Path) -> dict:
    store = CredentialStore(root)
    saved = store.load("peach-proxy")
    if saved:
        return dict(saved.values)
    # 已有来源仅有一个自定义地址时，它就是可无损继承的公共代理。
    legacy = set()
    for path in store.root.glob("scraping-*.json"):
        if path.name.endswith(".cooldown.json"):
            continue
        item = store.load(path.stem)
        if item and item.values.get("network") == "proxy" and item.values.get("proxy"):
            legacy.add(item.values["proxy"])
    if len(legacy) > 1:
        return {"mode": "environment", "conflict": True}
    return {"mode": "proxy", "proxy": legacy.pop()} if legacy else {"mode": "environment"}


def describe(root: Path) -> dict:
    saved = values(root)
    return {"mode": saved.get("mode", "environment"), "proxy_saved": bool(saved.get("proxy")),
            "needs_selection": bool(saved.get("conflict"))}


def save(root: Path, body: dict) -> dict:
    mode = body.get("mode")
    if mode not in {"environment", "direct", "proxy"}:
        raise ValueError("Peach 프록시 연결 방식을 선택하세요")
    address = body.get("proxy") or values(root).get("proxy", "")
    if not isinstance(address, str):
        raise ValueError("프록시 주소는 문자열이어야 합니다")
    address = address.strip()
    if mode == "proxy":
        try:
            parsed = urlsplit(address)
            valid = (parsed.scheme in {"http", "https", "socks5", "socks5h"} and parsed.hostname
                     and parsed.port and not parsed.query and not parsed.fragment and parsed.path in {"", "/"})
        except ValueError:
            valid = False
        if not valid or any(char.isspace() for char in address):
            raise ValueError("포트를 포함한 HTTP 또는 SOCKS 프록시 주소를 입력하세요")
    path = CredentialStore(root).path_for("peach-proxy")
    atomic_write_text(path, json.dumps({"mode": mode, "proxy": address if mode == "proxy" else ""}), mode=0o600)
    return describe(root)


def client_options(root: Path) -> dict:
    saved = values(root)
    if saved.get("conflict"):
        raise ValueError("소스별 프록시 설정이 다릅니다. 설정 페이지에서 Peach 프록시를 먼저 선택하세요")
    mode = saved.get("mode", "environment")
    if mode == "proxy":
        return {"trust_env": False, "proxy": saved["proxy"]}
    return {"trust_env": mode == "environment"}

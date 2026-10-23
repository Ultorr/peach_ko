"""媒体来源表单与配置映射；来源 ID 直接沿用扫描及流量策略。"""
from __future__ import annotations

from pathlib import Path, PurePath, PureWindowsPath, PurePosixPath
import shutil
import sys
from typing import Any

from . import platform
from .media_sources import SOURCE_OPTIONS, cost_for


def _windows_installed_names() -> list[str]:
    """从 Windows 安装清单读取软件名称，不读取命令、账户或凭据。"""
    if sys.platform != "win32":
        return []
    import winreg
    names = []
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                                    0, winreg.KEY_READ | view) as key:
                    for index in range(winreg.QueryInfoKey(key)[0]):
                        try:
                            with winreg.OpenKey(key, winreg.EnumKey(key, index)) as child:
                                names.append(str(winreg.QueryValueEx(child, "DisplayName")[0]).lower())
                        except OSError:
                            continue
            except OSError:
                continue
    return names


def mount_dependencies(*, system: str | None = None) -> list[dict[str, Any]]:
    """安装证据与挂载在线状态分别检测；只返回当前操作系统需要的依赖。"""
    system = system or sys.platform
    if system == "win32":
        names = _windows_installed_names()
        cloud = any(name.startswith("clouddrive") for name in names)
        driver, installed, url = "WinFsp", any(name.startswith("winfsp") for name in names), "https://winfsp.dev/rel/"
    elif system == "darwin":
        cloud = any((base / app).is_dir() for base in (Path("/Applications"), Path.home() / "Applications")
                    for app in ("CloudDrive.app", "CloudDrive2.app"))
        driver, installed, url = "macFUSE", Path("/Library/Filesystems/macfuse.fs").is_dir(), "https://macfuse.github.io/"
    else:
        return []
    cloud = cloud or any(shutil.which(name) for name in ("clouddrive", "clouddrive2", "CloudDrive"))
    return [{"name": "CloudDrive", "available": bool(cloud), "download_url": "https://www.clouddrive2.com/download.html"},
            {"name": driver, "available": installed, "download_url": url}]


def rows(config, *, windows: bool, probe: bool = False) -> list[dict[str, Any]]:
    result = []
    for location, roots in config.locations.items():
        mounts = config.mounts.get(location, ())
        for index, root in enumerate(roots):
            mount = root if windows else (mounts[index] if index < len(mounts) else "")
            result.append({"location": location, "root": root, "path": mount,
                           "library": config.library_names.get(root) or PureWindowsPath(root).name or root,
                           "library_icon": config.library_icons.get(root, ""),
                           "cost": cost_for(location, root, config),
                           "online": platform.root_online(Path(mount)) if probe and mount else False})
    return result


def _validated_paths(row: dict, *, windows: bool) -> tuple[PureWindowsPath, PurePath]:
    """将表单路径转换为可比较的声明根与本机绝对路径。"""
    text = str(row.get("path", "")).strip()
    root = text if windows else str(row.get("root", "")).strip()
    if any(ord(char) < 32 for char in text + root):
        raise ValueError("경로에 제어 문자를 사용할 수 없습니다")
    if not platform.is_windows_path(root) or ".." in PureWindowsPath(root).parts:
        raise ValueError("Windows 대응 경로에는 드라이브 문자가 필요합니다(예: B:\\). 네트워크 공유는 Windows 드라이브 문자에 먼저 연결하세요")
    path = PureWindowsPath(text) if windows else PurePosixPath(text)
    if not text or not (platform.is_windows_path(text) if windows else text.startswith("/")):
        raise ValueError("로컬 마운트 지점의 절대 경로를 입력하세요")
    if ".." in path.parts:
        raise ValueError("마운트 지점에 상위 폴더 표시(..)를 사용할 수 없습니다")
    return PureWindowsPath(root), path


def validate(raws: object, *, windows: bool) -> tuple[dict, dict, list[str]]:
    """离线来源允许保存；绝对路径、盘符根与来源间重叠在保存前校验。"""
    if not isinstance(raws, list) or not raws or len(raws) > 100:
        return {}, {}, ["미디어 폴더를 1~100개 추가하세요"]
    locations: dict[str, list[str]] = {}
    mounts: dict[str, list[str]] = {}
    errors = [""] * len(raws)
    seen: list[tuple[PureWindowsPath, PurePath]] = []
    for index, row in enumerate(raws):
        try:
            if not isinstance(row, dict):
                raise ValueError("미디어 소스 형식이 올바르지 않습니다")
            location = row.get("location")
            if not isinstance(location, str) or location not in dict(SOURCE_OPTIONS):
                raise ValueError("목록에서 미디어 소스를 선택하세요")
            if "cost" in row and row["cost"] not in ("free", "metered"):
                raise ValueError("프록시 트래픽 보호 설정을 선택하세요")
            declared, path = _validated_paths(row, windows=windows)
            for other_root, other_path in seen:
                if (declared == other_root or declared.is_relative_to(other_root)
                        or other_root.is_relative_to(declared)):
                    raise ValueError("Windows 대응 경로가 다른 폴더와 중복되거나 겹칩니다")
                if path == other_path or path.is_relative_to(other_path) or other_path.is_relative_to(path):
                    raise ValueError("로컬 마운트 지점이 다른 항목과 중복되거나 겹칩니다")
            seen.append((declared, path))
            locations.setdefault(location, []).append(str(declared))
            if not windows:
                mounts.setdefault(location, []).append(str(path))
        except ValueError as exc:
            errors[index] = str(exc)
    return ({key: tuple(value) for key, value in locations.items()},
            {key: tuple(value) for key, value in mounts.items()},
            errors if any(errors) else [])


def costs(raws: list[dict], config, *, windows: bool) -> dict[str, str]:
    """为已校验的媒体行保存声明根保护设置。"""
    result = dict(getattr(config, "media_costs", {}))
    for row in raws:
        root = str(PureWindowsPath(row["path"] if windows else row["root"]))
        for previous in tuple(result):
            if PureWindowsPath(previous) == PureWindowsPath(root):
                del result[previous]
        result[root] = row.get("cost", cost_for(row["location"], root, config))
    return result

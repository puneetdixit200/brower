#!/usr/bin/env python3
"""Install/remove an isolated user-scoped Aster debug launcher on Omarchy.

Never modifies global Hyprland settings or browser defaults. Does not remove
profiles on uninstall. The native binary must have been built separately.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile


IDENTIFIER = "aster-browser-debug"
DESKTOP_NAME = f"{IDENTIFIER}.desktop"
MANAGED = "X-Aster-Managed=true"
ICON_MANAGED = b"<!-- X-Aster-Managed: aster-browser-debug -->"


def _user_data() -> Path:
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))).expanduser()


def _desktop_value(path: Path) -> str:
    # Desktop Entry Exec syntax uses its own quoting rules, not a shell.
    text = str(path)
    if any(c in text for c in ('\n', '\r', '\x00')):
        raise ValueError("Unsafe newline or NUL in path")
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _write_managed(path: Path, content: bytes) -> None:
    if path.is_symlink():
        raise ValueError(f"Refusing to overwrite symlink: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(name, 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _paths() -> tuple[Path, Path, Path]:
    base = _user_data()
    return (
        base / "applications" / DESKTOP_NAME,
        base / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg",
        base / "aster-browser-debug-profile",
    )


def install(binary: Path, icon: Path, *, replace_managed: bool, ozone: str = "auto") -> None:
    if sys.platform != "linux":
        raise RuntimeError("Aster native debug launcher requires Linux")
    binary = binary.expanduser().resolve(strict=True)
    icon = icon.expanduser().resolve(strict=True)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"Aster native binary is not executable: {binary}")
    if not icon.is_file() or icon.suffix.lower() != ".svg":
        raise ValueError(f"Aster SVG icon is missing: {icon}")
    if ozone not in ("auto", "wayland", "x11"):
        raise ValueError("ozone must be auto, wayland or x11")
    desktop, icon_dest, profile = _paths()
    if desktop.is_symlink():
        raise ValueError(f"Refusing to overwrite symlinked launcher: {desktop}")
    if desktop.exists() or desktop.is_symlink():
        if not replace_managed or MANAGED not in desktop.read_text(encoding="utf-8"):
            raise ValueError(
                f"Launcher already exists at {desktop}. "
                "Only --replace-managed may update an Aster-owned launcher."
            )
    if icon_dest.exists() or icon_dest.is_symlink():
        if icon_dest.is_symlink() or ICON_MANAGED not in icon_dest.read_bytes():
            raise ValueError(f"Refusing to overwrite an icon not owned by Aster: {icon_dest}")
    # Keep the compiled debug browser independent from all other Chromium
    # product profiles, including a future signed Aster installation.
    ozone_option = (
        "--ozone-platform-hint=auto" if ozone == "auto"
        else f"--ozone-platform={ozone}"
    )
    command = (
        f"{_desktop_value(binary)} {ozone_option} "
        f"--user-data-dir={_desktop_value(profile)} %U"
    )
    contents = (
        "[Desktop Entry]\n"
        "Version=1.0\n"
        "Type=Application\n"
        "Name=Aster Browser (Development)\n"
        "GenericName=AI Web Browser\n"
        "Comment=Unsigned Aster native development build\n"
        f"Exec={command}\n"
        f"Icon={IDENTIFIER}\n"
        "Terminal=false\n"
        "StartupNotify=true\n"
        "Categories=Network;WebBrowser;\n"
        "MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\n"
        f"{MANAGED}\n"
    )
    # Read the source first; do not hardlink to the repo and do not touch any
    # other icon IDs or user-defined default browser settings.
    icon_bytes = icon.read_bytes().rstrip() + b"\n" + ICON_MANAGED + b"\n"
    _write_managed(icon_dest, icon_bytes)
    _write_managed(desktop, contents.encode("utf-8"))
    print(f"Installed Aster launcher: {desktop}")
    print(f"Isolated profile location: {profile}")
    print(f"Ozone display selection: {ozone}")
    print("No default application or Hyprland shortcuts were changed.")
    print("This is an UNSIGNED development launcher; sandbox flags were not relaxed.")


def uninstall() -> None:
    desktop, icon, profile = _paths()
    if desktop.is_symlink():
        raise ValueError("Refusing to delete symlinked launcher")
    if desktop.exists():
        if MANAGED not in desktop.read_text(encoding="utf-8"):
            raise ValueError("Refusing to remove a desktop file not owned by Aster")
        desktop.unlink()
        if icon.is_file() and not icon.is_symlink() and ICON_MANAGED in icon.read_bytes():
            icon.unlink()
    print(f"Removed managed launcher (if present). User profile retained: {profile}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    create = sub.add_parser("install")
    create.add_argument("--binary", type=Path, required=True)
    create.add_argument(
        "--icon", type=Path,
        default=Path(__file__).resolve().parents[1] / "resources/aster/icons/aster-mark.svg",
    )
    create.add_argument("--replace-managed", action="store_true")
    create.add_argument(
        "--ozone", choices=("auto", "wayland", "x11"), default="auto",
        help="Choose Wayland, explicit X11 fallback, or Chromium auto detection",
    )
    sub.add_parser("uninstall")
    args = parser.parse_args()
    if args.action == "install":
        install(
            args.binary, args.icon,
            replace_managed=args.replace_managed, ozone=args.ozone,
        )
    else:
        uninstall()


if __name__ == "__main__":
    main()

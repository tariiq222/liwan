#!/usr/bin/env python3
"""Create the private Odoo database-manager password for the local fixture."""

import fcntl
import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path


MASTER_KEY = "FIXTURE_ODOO_MASTER_PASSWORD"
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.:-]+$")
SAFE_MASTER = re.compile(r"^[A-Za-z0-9_-]{40,}$")
ALLOWED_KEYS = {
    "FIXTURE_PG_PASSWORD",
    "FIXTURE_ODOO_MASTER_PASSWORD",
    "NASQ_FIXTURE_ADMIN_LOGIN",
    "NASQ_FIXTURE_ADMIN_PASSWORD",
    "NASQ_FIXTURE_MARKER",
}


class UnsafeSecretsFile(Exception):
    pass


def verify_private_file(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise UnsafeSecretsFile
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise UnsafeSecretsFile
    parent = path.parent.stat()
    if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077:
        raise UnsafeSecretsFile


def parse_secrets(data: bytes) -> list[tuple[str, str]]:
    try:
        lines = data.decode("ascii").splitlines()
    except UnicodeDecodeError as exc:
        raise UnsafeSecretsFile from exc
    parsed: list[tuple[str, str]] = []
    seen: set[str] = set()
    for line in lines:
        if not line or "=" not in line:
            raise UnsafeSecretsFile
        key, value = line.split("=", 1)
        if key not in ALLOWED_KEYS or key in seen or not SAFE_VALUE.fullmatch(value):
            raise UnsafeSecretsFile
        seen.add(key)
        parsed.append((key, value))
    return parsed


def ensure_master_password(path: Path) -> None:
    if path.is_symlink():
        raise UnsafeSecretsFile
    verify_private_file(path)
    lock_path = path.with_name(f".{path.name}.lock")
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(lock_fd, 0o600)
        lock_info = os.fstat(lock_fd)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid():
            raise UnsafeSecretsFile
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        verify_private_file(path)
        original = path.read_bytes()
        entries = parse_secrets(original)
        values = dict(entries)
        current = values.get(MASTER_KEY)
        if current is not None:
            if not SAFE_MASTER.fullmatch(current):
                raise UnsafeSecretsFile
            return

        master = secrets.token_urlsafe(36)
        updated = original
        if updated and not updated.endswith(b"\n"):
            updated += b"\n"
        updated += f"{MASTER_KEY}={master}\n".encode("ascii")
        fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as temporary:
                temporary.write(updated)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, path)
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)
    finally:
        os.close(lock_fd)


def main() -> int:
    try:
        if len(sys.argv) != 2:
            raise UnsafeSecretsFile
        ensure_master_password(Path(sys.argv[1]))
    except (OSError, UnsafeSecretsFile, ValueError):
        print("cannot safely prepare fixture secrets", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

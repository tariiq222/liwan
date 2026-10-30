#!/usr/bin/env python3
"""Start isolated mock API + Nuxt, run internal-ui-audit Playwright, then stop both."""
from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
MOCK_PORT = 4388
NUXT_PORT = 4387
MOCK_URL = f"http://127.0.0.1:{MOCK_PORT}"
NUXT_URL = f"http://127.0.0.1:{NUXT_PORT}"
SHOTS = WEB / "test-results" / "internal-ui-audit"


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def wait_http(url: str, timeout: float) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as res:
                if 200 <= res.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001 — probe until ready
            last = exc
        time.sleep(0.5)
    raise SystemExit(f"timeout waiting for {url}: {last}")


def stop(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=4)


def main() -> int:
    if not port_free(MOCK_PORT):
        raise SystemExit(f"port {MOCK_PORT} is in use")
    if not port_free(NUXT_PORT):
        raise SystemExit(f"port {NUXT_PORT} is in use")

    SHOTS.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    nuxt_env = {
        **env,
        "NUXT_ODOO_URL": MOCK_URL,
        "NUXT_ODOO_DB": "liwan_ui_mock_only",
        "NUXT_PUBLIC_WS_URL": f"ws://127.0.0.1:{MOCK_PORT}/websocket",
        "NITRO_HOST": "127.0.0.1",
        "NITRO_PORT": str(NUXT_PORT),
    }
    build = subprocess.run(["npm", "run", "build"], cwd=str(WEB), env=nuxt_env, check=False)
    if build.returncode:
        return build.returncode
    mock = None
    nuxt = None
    code = 1
    try:
        mock = subprocess.Popen(
            ["node", str(Path(__file__).with_name("internal-ui-audit-mock.mjs"))],
            cwd=str(WEB), env={**env, "MOCK_PORT": str(MOCK_PORT)}, start_new_session=True,
        )
        nuxt = subprocess.Popen(
            ["node", ".output/server/index.mjs"], cwd=str(WEB), env=nuxt_env, start_new_session=True,
        )
        wait_http(f"{MOCK_URL}/api/v1/branding", 15)
        wait_http(f"{NUXT_URL}/login", 180)
        time.sleep(2)
        wait_http(f"{NUXT_URL}/login", 30)
        play_env = {
            **env,
            "E2E_BASE_URL": NUXT_URL,
            "INTERNAL_UI_AUDIT_SHOTS": str(SHOTS),
        }
        play = subprocess.run(
            ["npx", "--no-install", "playwright", "test", "e2e/internal-ui-audit.spec.ts", "--reporter=list"],
            cwd=str(WEB),
            env=play_env,
            check=False,
        )
        code = play.returncode
        print(f"PLAYWRIGHT_EXIT={code}")
        return code
    finally:
        stop(nuxt)
        stop(mock)
        print("servers stopped")


if __name__ == "__main__":
    raise SystemExit(main())

"""The hashed lock files cover every dependency that pyproject.toml declares."""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HASH = re.compile(r"^\s+--hash=sha256:[0-9a-f]{64}", re.MULTILINE)


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def declared(requirements: list[str]) -> set[str]:
    return {normalized(re.split(r"[\[<>=!~ ;]", requirement, maxsplit=1)[0]) for requirement in requirements}


def locked(name: str) -> dict[str, int]:
    """Locked package -> number of hashes, from one requirements file."""
    entries = re.split(r"\n(?=\S)", (ROOT / name).read_text(encoding="utf-8"))
    return {normalized(entry.split("==", 1)[0]): len(HASH.findall(entry)) for entry in entries if "==" in entry.split("\n", 1)[0]}


def project() -> dict:
    return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]


def test_runtime_lock_pins_every_dependency_with_hashes():
    pins = locked("requirements.txt")
    assert declared(project()["dependencies"]) <= pins.keys()
    assert all(count >= 1 for count in pins.values()), [name for name, count in pins.items() if not count]


def test_dev_lock_contains_the_runtime_set_and_the_dev_extra():
    runtime, dev = locked("requirements.txt"), locked("requirements-dev.txt")
    assert runtime.keys() <= dev.keys()
    assert declared(project()["optional-dependencies"]["dev"]) <= dev.keys()
    assert all(count >= 1 for count in dev.values())


def test_build_and_audit_tools_are_locked_with_hashes():
    assert "setuptools" in locked("requirements-build.txt")
    assert "pip-audit" in locked("requirements-audit.txt")
    assert all(count >= 1 for count in locked("requirements-audit.txt").values())


def test_the_image_installs_only_from_the_hashed_lock():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    installs = [line for line in dockerfile.splitlines() if "pip install" in line]
    assert installs
    assert all("--require-hashes" in line or "--no-deps" in line for line in installs), installs

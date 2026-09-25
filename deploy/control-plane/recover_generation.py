#!/usr/bin/env python3
"""Fail-closed, serialized archival of one fully dead process generation."""
from __future__ import annotations
import errno
import os
import re
import subprocess
import sys
import shlex
from pathlib import Path
from typing import Callable

NAMES = ('runtime.pid', 'runtime.start', 'api.pid', 'api.start', 'api.generation', 'worker.pid', 'worker.start', 'worker.generation', 'generation')
GEN_RE = re.compile(r'^[a-f0-9]{32}$')


def _listener_present() -> bool:
    try:
        result = subprocess.run(['lsof', '-nP', '-iTCP:14179', '-sTCP:LISTEN'], capture_output=True, text=True, check=False)
    except OSError:
        return True
    return result.returncode != 1 or bool(result.stdout.strip())


def _process_snapshot() -> dict[int, tuple[int, str, str]]:
    try:
        result = subprocess.run(['/bin/ps', '-ww', '-axo', 'pid=,ppid=,lstart=,command='], capture_output=True, text=True, check=False)
    except OSError as exc:
        raise ValueError('process_enumeration_failed') from exc
    if result.returncode:
        raise ValueError('process_enumeration_failed')
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 7)
        if len(fields) != 8 or not fields[0].isdigit() or not fields[1].isdigit():
            raise ValueError('process_metadata_uncertain')
        pid, ppid = int(fields[0]), int(fields[1])
        if pid in rows:
            raise ValueError('process_metadata_uncertain')
        rows[pid] = (ppid, ' '.join(fields[2:7]), fields[7])
    return rows


def _runtime_artifacts(root: Path) -> tuple[Path, ...]:
    """Root-owned launch artifacts. The shared node binary is deliberately absent."""
    return (
        root / 'deploy/control-plane/run-local.sh',
        root / 'deploy/control-plane/startup_handoff.py',
        root / 'deploy/control-plane/process_lock.py',
        root / 'node_modules/tsx/dist/cli.mjs',
        root / 'apps/control-plane/src/main.ts',
        root / 'apps/control-plane/src/worker-main.ts',
    )


def _names_own_artifact(token: str, root: Path, artifacts: tuple[Path, ...]) -> bool:
    """True only when the argv token names one of THIS root's artifacts.

    Absolute tokens are canonicalized, so a symlink or alias of a root artifact
    still counts. A relative token is accepted only when it equals the
    root-relative artifact path exactly: another process's working directory is
    not observable, so a bare basename is never treated as identity.
    """
    try:
        candidate = Path(token)
    except (TypeError, ValueError):
        return False
    if candidate.is_absolute():
        resolved = candidate.resolve()
        return any(resolved == artifact.resolve() for artifact in artifacts)
    normalized = Path(*[part for part in candidate.parts if part != '.'])
    return any(normalized == artifact.relative_to(root) for artifact in artifacts)


def _contains_absolute_artifact(text: str, artifacts: tuple[Path, ...]) -> bool:
    """Component-bounded search for a full absolute artifact path inside shell text."""
    for artifact in artifacts:
        for needle in {str(artifact), str(artifact.resolve())}:
            start = 0
            while True:
                index = text.find(needle, start)
                if index < 0:
                    break
                end = index + len(needle)
                if end == len(text) or not (text[end].isalnum() or text[end] in '._/-'):
                    return True
                start = index + 1
    return False


def _runtime_candidate(command: str, root: Path, node_bin: Path) -> bool:
    """True only for a launch of THIS root's runtime, wrappers or entrypoints.

    The node executable alone is not identity: an unrelated process (for example
    a Nuxt dev server under another root that happens to share the same node
    binary) must not be treated as a publisher. Evidence must be a root-scoped
    tsx/entrypoint or a root runtime wrapper, absolute (canonicalized) or exactly
    root-relative. A shell wrapper that carries a full absolute root artifact is
    conservatively a candidate; shell text we cannot classify is not, and
    unparsable argv that mentions a root artifact fails closed instead.
    """
    del node_bin  # kept for caller compatibility; never identity on its own
    artifacts = _runtime_artifacts(root)
    try:
        argv = shlex.split(command)
    except ValueError:
        if _contains_absolute_artifact(command, artifacts):
            raise ValueError('process_metadata_uncertain') from None
        return False
    if not argv:
        raise ValueError('process_metadata_uncertain')
    if any(_names_own_artifact(token, root, artifacts) for token in argv):
        return True
    if any(arg in ('-c', '-S', '-m') for arg in argv[:-1]) and _contains_absolute_artifact(command, artifacts):
        return True
    return False


def _coordinator_command(argv: list[str], expected: Path) -> bool:
    """True only for the trusted run-local.sh supervisor, in any documented path form.

    run-local.sh is reached through exec-only wrappers (process_lock --hold,
    startup_handoff), so $0 survives exactly as the operator wrote it: absolute,
    relative, or through a symlink. Compare resolved paths instead of the raw
    argv string; no other script and no other ancestor is accepted here.
    """
    if not (2 <= len(argv) <= 3) or Path(argv[0]).name not in ('bash', 'sh'):
        return False
    if len(argv) == 3 and argv[2] != 'runtime':
        return False
    try:
        return Path(argv[1]).resolve() == expected
    except OSError:
        return False


def _coordinator_identity(rows: dict[int, tuple[int, str, str]], begin_pid: int, root: Path) -> tuple[int, str]:
    if begin_pid not in rows:
        raise ValueError('process_ancestry_uncertain')
    pid = rows[begin_pid][0]
    visited = {begin_pid}
    expected = (root / 'deploy/control-plane/run-local.sh').resolve()
    begin_script = str(root / 'deploy/control-plane/begin_generation.py')
    while pid > 1:
        if pid in visited or pid not in rows:
            raise ValueError('process_ancestry_uncertain')
        visited.add(pid)
        ppid, start, command = rows[pid]
        try:
            argv = shlex.split(command)
        except ValueError:
            raise ValueError('process_ancestry_uncertain') from None
        if _coordinator_command(argv, expected):
            return pid, start
        if not argv or not any(token == begin_script or Path(token).name == 'begin_generation.py' for token in argv):
            raise ValueError('locked_coordinator_unverified')
        pid = ppid
    raise ValueError('locked_coordinator_unverified')


def _runtime_candidates_present(root: Path, node_bin: Path, begin_pid: int, coordinator: tuple[int, str]) -> bool:
    rows = _process_snapshot()
    if _coordinator_identity(rows, begin_pid, root) != coordinator:
        raise ValueError('locked_coordinator_changed')
    return any(_runtime_candidate(command, root, node_bin) and (pid, start) != coordinator
               for pid, (_ppid, start, command) in rows.items() if pid > 1)


def pid_is_absent(pid: int, kill: Callable = os.kill) -> bool:
    try:
        kill(pid, 0)
    except OSError as exc:
        return exc.errno == errno.ESRCH
    return False


def _validate(state: Path, pid_probe: Callable[[int], bool], listener_check: Callable[[], bool]) -> tuple[str, dict[str, bytes]]:
    if state.is_symlink() or not state.is_dir():
        raise ValueError('invalid_process_directory')
    entries = list(state.iterdir())
    if {p.name for p in entries} != set(NAMES):
        raise ValueError('incomplete_or_unexpected_records')
    data: dict[str, bytes] = {}
    for name in NAMES:
        path = state / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('invalid_record_type')
        data[name] = path.read_bytes()
    try:
        generation = data['generation'].decode().strip()
        if not GEN_RE.fullmatch(generation):
            raise ValueError
        if data['api.generation'].decode().strip() != generation or data['worker.generation'].decode().strip() != generation:
            raise ValueError
        pids = [int(data[f'{n}.pid'].decode().strip()) for n in ('runtime', 'api', 'worker')]
        starts = [data[f'{n}.start'].decode().strip() for n in ('runtime', 'api', 'worker')]
        if len(set(pids)) != 3 or any(pid <= 1 for pid in pids) or not all(starts):
            raise ValueError
    except (UnicodeDecodeError, ValueError):
        raise ValueError('invalid_or_mixed_generation') from None
    for pid in pids:
        if not pid_probe(pid):
            raise ValueError(f'pid_live_or_uncertain:{pid}')
    return generation, data


def recover_reservation(state: Path, home: Path, root: Path, node_bin: Path, begin_pid: int,
                        listener_check: Callable[[], bool] = _listener_present,
                        candidate_check: Callable[[Path, Path, int, tuple[int, str]], bool] = _runtime_candidates_present,
                        rename: Callable = os.rename, mkdir: Callable = os.mkdir) -> Path:
    """Archive only an intact generation-only reservation after proving no publisher exists."""
    def validate_reservation() -> str:
        if state.is_symlink() or not state.is_dir():
            raise ValueError('invalid_process_directory')
        entries = list(state.iterdir())
        if len(entries) != 1 or entries[0].name != 'generation':
            raise ValueError('reservation_has_unexpected_entries')
        marker = entries[0]
        if marker.is_symlink() or not marker.is_file():
            raise ValueError('invalid_reservation_marker')
        raw = marker.read_bytes()
        try:
            text = raw.decode('ascii')
        except UnicodeDecodeError:
            raise ValueError('invalid_reservation_marker') from None
        if not text.endswith('\n') or not GEN_RE.fullmatch(text[:-1]):
            raise ValueError('invalid_reservation_marker')
        return text[:-1]

    generation = validate_reservation()
    rows = _process_snapshot()
    coordinator = _coordinator_identity(rows, begin_pid, root)
    # The reserved state contains no start-time record, so retain only the exact
    # direct coordinator identity from the coherent process snapshot and recheck it.
    if candidate_check(root, node_bin, begin_pid, coordinator):
        raise ValueError('runtime_process_present_or_uncertain')
    if listener_check():
        raise ValueError('api_listener_present_or_uncertain')
    if validate_reservation() != generation:
        raise ValueError('reservation_changed')
    if candidate_check(root, node_bin, begin_pid, coordinator):
        raise ValueError('runtime_process_appeared_or_uncertain')
    if listener_check():
        raise ValueError('api_listener_appeared_or_uncertain')
    archive = home / f'processes-archive-reservation-{generation}-{os.getpid()}'
    if archive.exists() or archive.is_symlink():
        raise ValueError('archive_destination_exists')
    rename(state, archive)
    try:
        mkdir(state, 0o700)
    except OSError:
        if not state.exists() and not state.is_symlink():
            try:
                rename(archive, state)
            except OSError:
                raise ValueError(f'archive_preserved_restore_failed:{archive}') from None
        raise ValueError('state_directory_recreate_failed_reservation_archived') from None
    return archive


def recover(state: Path, home: Path, pid_probe: Callable[[int], bool] = pid_is_absent,
            listener_check: Callable[[], bool] | None = None,
            rename: Callable = os.rename, mkdir: Callable = os.mkdir) -> Path:
    if listener_check is None:
        def listener_check() -> bool:
            try:
                result = subprocess.run(['lsof', '-nP', '-iTCP:14179', '-sTCP:LISTEN'], capture_output=True, check=False)
            except OSError:
                return True
            return result.returncode != 1 or bool(result.stdout.strip())
    generation, _ = _validate(state, pid_probe, listener_check)
    if listener_check():
        raise ValueError('api_listener_present')
    _validate(state, pid_probe, lambda: False)  # Re-probe immediately before atomic archive under lock.
    if listener_check():
        raise ValueError('api_listener_appeared')
    archive = home / f'processes-archive-{generation}-{os.getpid()}'
    if archive.exists() or archive.is_symlink():
        raise ValueError('archive_destination_exists')
    rename(state, archive)
    try:
        mkdir(state, 0o700)
    except OSError:
        try:
            rename(archive, state)
        except OSError:
            raise ValueError(f'archive_preserved_restore_failed:{archive}') from None
        raise ValueError('state_directory_recreate_failed_records_restored') from None
    return archive


def main() -> int:
    if len(sys.argv) != 3:
        print('invalid_arguments'); return 2
    home, state = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        archive = recover(state, home)
    except (ValueError, OSError) as exc:
        print(str(exc) if isinstance(exc, ValueError) else 'filesystem_error')
        return 1
    print(f'archived_dead_generation={archive.name}; no process signaled or record deleted')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

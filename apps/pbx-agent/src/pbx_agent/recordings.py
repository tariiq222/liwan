"""Where a call recording lives and how it is served (design 4.4).

Asterisk's MixMonitor writes ``<linkedid>.wav`` into the mounted recordings directory. The only name this module
accepts is that call id; the resolved file must stay directly inside the directory, so a traversal, a symlink out of
the directory and a directory listing are all impossible.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pbx_agent.signing import CALL_ID

if TYPE_CHECKING:
    from pathlib import Path

RECORDING_SUFFIX = ".wav"


def recording_path(root: Path, call_id: str) -> Path | None:
    """The recording file of ``call_id``, or ``None`` when the name is unsafe or the file is absent."""
    if not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id):
        return None
    directory = root.resolve()
    candidate = (directory / f"{call_id}{RECORDING_SUFFIX}").resolve()
    if candidate.parent != directory or not candidate.is_file():
        return None
    return candidate

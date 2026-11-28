"""Where a call recording lives, how it is served, deleted, and how Odoo learns it exists (design 4.4).

Asterisk's MixMonitor writes ``<linkedid>.wav`` into the mounted recordings directory. The only name this module
accepts is that call id; the resolved file must stay directly inside the directory, so a traversal, a symlink out of
the directory and a directory listing are all impossible. Once a call's legs are gone, the file's presence is what
makes the agent tell Odoo the recording is ready, and the same rule is what lets Odoo delete that file by call id.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pbx_agent.events import recording_ready_event
from pbx_agent.signing import CALL_ID

if TYPE_CHECKING:
    from pathlib import Path

    from pbx_agent.queue import EventQueue

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


def announce_recording(queue: EventQueue, root: Path, ended: dict, *, now: float) -> str | None:
    """Queue the recording-ready event of the call an ``ended`` event closed; ``None`` when there is nothing to announce.

    It answers ``None`` when MixMonitor left no file for the call and when the call's recording was already announced:
    a later end of the same call, from the stream or from CEL, changes nothing. The event is queued like every other
    one, so it reaches Odoo with the same signature and retries.
    """
    linkedid = ended["call"]["linkedid"]
    if recording_path(root, linkedid) is None:
        return None
    return queue.enqueue_for_recording(linkedid, recording_ready_event(ended, now=now), now=int(now))


def delete_recording(root: Path, call_id: str) -> bool:
    """Unlink ``call_id``'s recording; ``False`` when there is no file to delete.

    ``recording_path`` owns both the name rule and the containment check, so a traversal, a symlink out of the
    directory and a directory named like a recording delete nothing. A file that vanishes between the check and the
    unlink is ``False``; any other OS error propagates, so Odoo retries instead of being told a kept file is gone.
    """
    path = recording_path(root, call_id)
    if path is None:
        return False
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    return True

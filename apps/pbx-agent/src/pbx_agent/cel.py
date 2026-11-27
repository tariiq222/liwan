"""Reads Asterisk's CEL log so reconciliation can rebuild a call leg the event stream lost (design 4.6).

The package configures ``cel_custom.conf`` with the column order below and writes one CSV file; this module tails
that file by byte offset, so each run reads only what was appended. Fields are read with Python's ``csv`` reader,
so a quoted field that contains a comma (``Dial`` appdata, for example) is one field and a genuinely broken row is
skipped and counted, never guessed at.

Two bounds keep one odd row from pinning the offset forever:

- a leg CEL never closed is sent as failed once it has been open for ``MAX_OPEN_LEG_SECONDS``;
- a leg that ended less than ``LIVE_RACE_SETTLE_SECONDS`` ago waits one pass, so the live end event can mark it and
  reconciliation cannot emit a second ended event with a different id.

A file is identified by its device, inode and a digest of its first line, so a rotated or rewritten file is read
from the start instead of from an offset that points into the middle of a line of another file.
"""

from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from pbx_agent.events import parse_cel_time

if TYPE_CHECKING:
    from pathlib import Path

CEL_COLUMNS = (
    "eventtype",
    "eventtime",
    "cidname",
    "cidnum",
    "cidani",
    "cidrdnis",
    "ciddnid",
    "exten",
    "context",
    "channame",
    "appname",
    "appdata",
    "amaflags",
    "accountcode",
    "uniqueid",
    "linkedid",
    "userfield",
    "peeraccount",
    "sequence",
)
COLUMN = {name: position for position, name in enumerate(CEL_COLUMNS)}
HANGUP_EVENTS = ("HANGUP", "CHAN_END")
IDENTITY_BYTES = 512
# Six hours: longer than any real call, short enough that a leg whose hangup never reached CEL stops holding the file.
MAX_OPEN_LEG_SECONDS = 6 * 60 * 60
# One minute: the window in which the live end event of a just-finished call can still arrive and mark its leg.
LIVE_RACE_SETTLE_SECONDS = 60
# What a queue records when the file did not exist yet: the file that appears afterwards was written by the live
# system, so it is read from its first byte.
ABSENT_IDENTITY = "absent"


@dataclass(frozen=True)
class CelRow:
    """One CSV row with its byte range in the file."""

    fields: tuple[str, ...]
    start: int
    end: int


@dataclass(frozen=True)
class CallLeg:
    """One channel's life as CEL recorded it."""

    uniqueid: str
    linkedid: str
    channel: str
    caller_number: str | None
    dialed_exten: str | None
    context: str
    started_at: str | None
    answered_at: str | None
    ended_at: str | None
    abandoned: bool = False


@dataclass(frozen=True)
class CelBatch:
    legs: tuple[CallLeg, ...]
    offset: int
    hold_start: int | None
    skipped: int


def read_rows(path: Path, offset: int) -> tuple[list[CelRow], int, int]:
    """Complete rows appended after ``offset``; the returned end stops on a whole line, so a partial write waits."""
    if path.stat().st_size < offset:
        offset = 0
    with path.open("rb") as handle:
        handle.seek(offset)
        data = handle.read()
    end = data.rfind(b"\n") + 1
    rows: list[CelRow] = []
    skipped = 0
    position = offset
    for line in data[:end].split(b"\n")[:-1]:
        start = position
        position += len(line) + 1
        text = line.decode("utf-8", "replace").rstrip("\r")
        if not text.strip():
            continue
        try:
            fields = next(csv.reader([text]), [])
        except csv.Error:
            # An unbalanced quote that the reader cannot recover from is a broken row, not a call we invent.
            skipped += 1
            continue
        if len(fields) != len(CEL_COLUMNS):
            skipped += 1
            continue
        rows.append(CelRow(fields=tuple(fields), start=start, end=position))
    return rows, offset + end, skipped


def legs_from_rows(rows: list[CelRow], *, now: float) -> tuple[tuple[CallLeg, ...], int | None]:
    """The legs to send, plus the first byte that must be re-read next pass (``None`` when nothing is held)."""
    collected: dict[str, dict] = {}
    for row in rows:
        uniqueid = row.fields[COLUMN["uniqueid"]]
        if not uniqueid:
            continue
        leg = collected.setdefault(
            uniqueid,
            {
                "first": None,
                "started": None,
                "answered": None,
                "ended": None,
                "start_row": row.start,
                "last": row,
                "last_time": None,
            },
        )
        leg["last"] = row
        moment = parse_cel_time(row.fields[COLUMN["eventtime"]])
        if moment is not None:
            leg["last_time"] = moment
        eventtype = row.fields[COLUMN["eventtype"]]
        if leg["first"] is None and moment is not None:
            leg["first"] = moment
        if eventtype == "CHAN_START" and leg["started"] is None:
            leg["started"] = moment
        elif eventtype == "ANSWER" and leg["answered"] is None:
            leg["answered"] = moment
        elif eventtype in HANGUP_EVENTS and moment is not None:
            leg["ended"] = moment
    legs: list[CallLeg] = []
    hold_start: int | None = None
    for uniqueid, leg in collected.items():
        if leg["ended"] is None:
            started = _epoch(leg["started"] or leg["first"])
            if started is not None and now - started > MAX_OPEN_LEG_SECONDS:
                legs.append(_call_leg(uniqueid, leg, ended_at=leg["last_time"] or leg["first"], abandoned=True))
                continue
            hold_start = _hold(hold_start, leg["start_row"])
            continue
        ended = _epoch(leg["ended"])
        if ended is not None and 0 <= now - ended < LIVE_RACE_SETTLE_SECONDS:
            hold_start = _hold(hold_start, leg["start_row"])
            continue
        legs.append(_call_leg(uniqueid, leg, ended_at=leg["ended"], abandoned=False))
    return tuple(legs), hold_start


def _call_leg(uniqueid: str, leg: dict, *, ended_at: str | None, abandoned: bool) -> CallLeg:
    row = leg["last"]
    return CallLeg(
        uniqueid=uniqueid,
        linkedid=row.fields[COLUMN["linkedid"]],
        channel=row.fields[COLUMN["channame"]],
        caller_number=row.fields[COLUMN["cidnum"]] or None,
        dialed_exten=row.fields[COLUMN["exten"]] or None,
        context=row.fields[COLUMN["context"]],
        started_at=leg["started"] or leg["first"],
        answered_at=leg["answered"],
        ended_at=ended_at,
        abandoned=abandoned,
    )


def _epoch(moment: str | None) -> float | None:
    if not moment:
        return None
    try:
        return datetime.fromisoformat(moment.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _hold(current: int | None, start: int) -> int:
    return start if current is None else min(current, start)


class CelFile:
    """The CEL CSV on disk; a missing or rotated file never loses the offset bookkeeping silently."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def identity(self) -> str:
        """A value that changes when the file is rotated or rewritten; raises ``OSError`` when it is absent.

        Only the first line is hashed: it stays the same while the file grows, and it changes when the file is
        rewritten. A file adopted while empty changes identity on its first append, which reads it from byte 0.
        """
        stat = self._path.stat()
        with self._path.open("rb") as handle:
            first_line = handle.readline(IDENTITY_BYTES)
        digest = hashlib.sha256(first_line).hexdigest()[:32]
        return f"{stat.st_dev}:{stat.st_ino}:{digest}"

    def size(self) -> int:
        return self._path.stat().st_size

    def read(self, offset: int, *, now: float) -> CelBatch:
        rows, end, skipped = read_rows(self._path, offset)
        legs, hold_start = legs_from_rows(rows, now=now)
        return CelBatch(legs=legs, offset=end, hold_start=hold_start, skipped=skipped)

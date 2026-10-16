"""Records mentioned by tool results, for the answer's link cards."""
from __future__ import annotations

from typing import Any

MAX_RECORDS = 20
TYPE_BY_WORD = (("task", "task"), ("project", "project"), ("meeting", "meeting"), ("employee", "employee"))


def _record_type(tool_name: str) -> str:
    verb_object = tool_name.split(".", 1)[-1]
    for word, record_type in TYPE_BY_WORD:
        if word in verb_object:
            return record_type
    return "record"


def _rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(data.get("items"), list):
        return [row for row in data["items"] if isinstance(row, dict)]
    return [data]


def records_from_results(results: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, int]] = set()
    out: list[dict[str, Any]] = []
    for tool_name, data in results:
        record_type = _record_type(tool_name)
        for row in _rows(data):
            row_id, label = row.get("id"), row.get("name")
            if not isinstance(row_id, int) or not isinstance(label, str):
                continue
            if (record_type, row_id) in seen:
                continue
            seen.add((record_type, row_id))
            out.append({"type": record_type, "id": row_id, "label": label})
            if len(out) == MAX_RECORDS:
                return out
    return out

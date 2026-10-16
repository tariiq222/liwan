"""Records mentioned by tool results, for the answer's link cards."""
from __future__ import annotations

import re
from typing import Any

MAX_RECORDS = 20
MIN_LABEL_LENGTH = 3  # shorter labels are too ambiguous to match by text alone
_EMPHASIS = re.compile(r"[*_`]")
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


def _normalize(text: str) -> str:
    return " ".join(_EMPHASIS.sub("", text).split()).casefold()


def _references_id(answer_text: str, row_id: int) -> bool:
    """`#5`, `ID: 5`, `id 5` or `(5)`, never inside a longer number."""
    return re.search(rf"(?<!\d)(?:#|\bid\s*:?\s*){row_id}(?!\d)|\({row_id}\)", answer_text, re.IGNORECASE) is not None


def _is_mentioned(answer_text: str, normalized_answer: str, row_id: int, label: str) -> bool:
    normalized_label = _normalize(label)
    by_label = len(normalized_label) >= MIN_LABEL_LENGTH and normalized_label in normalized_answer
    return by_label or _references_id(answer_text, row_id)


def records_from_results(results: list[tuple[str, dict[str, Any]]], answer_text: str) -> list[dict[str, Any]]:
    """Tool-result rows the answer text refers to, by label or by id; none referenced means none returned."""
    normalized_answer = _normalize(answer_text)
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
            if not _is_mentioned(answer_text, normalized_answer, row_id, label):
                continue
            seen.add((record_type, row_id))
            out.append({"type": record_type, "id": row_id, "label": label})
            if len(out) == MAX_RECORDS:
                return out
    return out

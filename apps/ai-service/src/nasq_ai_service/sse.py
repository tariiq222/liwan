from __future__ import annotations

import json
from typing import Any


def format_event(name: str, data: Any) -> bytes:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()

"""The two stand-ins of the agent's tests: an ARI that answers without a socket, and the HTTP call to Odoo."""

from __future__ import annotations

from typing import NamedTuple


class AriRequest(NamedTuple):
    """One call the agent made: the method, the path, the query parameters and the JSON body."""

    method: str
    path: str
    params: dict | None
    body: dict | None


class FakeAri:
    """Answers like ARI: the answer scripted for a ``(method, path)``, and 204 for every other request."""

    def __init__(self, answers: dict | None = None) -> None:
        self.answers = answers or {}
        self.requests: list[AriRequest] = []

    def __call__(self, method: str, path: str, params: dict | None = None, body: dict | None = None) -> tuple[int, object]:
        self.requests.append(AriRequest(method, path, params, body))
        return self.answers.get((method, path), (204, None))


class Recorder:
    """Stands in for the HTTP call: records every attempt and answers what the test told it to."""

    def __init__(self, answers: list) -> None:
        self.answers = answers
        self.calls: list[dict] = []

    def __call__(self, url, body, headers, timeout) -> int:
        self.calls.append({"url": url, "body": body, "headers": headers, "timeout": timeout})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

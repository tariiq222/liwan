"""The stand-ins of the agent's tests: ARI, PostgreSQL pbx-db store, and the HTTP call to Odoo."""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from collections.abc import Sequence


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


class FakePbxStore:
    """In-memory stand-in for ``PostgresPbxStore`` that models atomic transactions and records calls."""

    def __init__(self, *, fail_on: set[str] | None = None) -> None:
        self.fail_on: set[str] = set(fail_on or ())
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.auths: dict[str, dict[str, str]] = {}
        self.aors: dict[str, dict[str, object]] = {}
        self.endpoints: dict[str, dict[str, object]] = {}

    def _check_failure(self, op: str) -> None:
        if op in self.fail_on:
            from pbx_agent.pbx_db import PbxStoreError

            raise PbxStoreError("pbx database write failed")

    def upsert_extension_session(
        self,
        *,
        extension: str,
        auth_id: str,
        auth_username: str,
        password: str,
        auth_ids: Sequence[str],
        session_seconds: int,
        transport: str,
        context: str,
        from_domain: str,
        drop_auth_ids: Sequence[str] = (),
    ) -> None:
        payload: dict[str, object] = {
            "extension": extension,
            "auth_id": auth_id,
            "auth_username": auth_username,
            "password": password,
            "auth_ids": list(auth_ids),
            "session_seconds": session_seconds,
            "transport": transport,
            "context": context,
            "from_domain": from_domain,
            "drop_auth_ids": list(drop_auth_ids),
        }
        self.calls.append(("upsert_extension_session", payload))
        self._check_failure("upsert_extension_session")
        self.auths[auth_id] = {"auth_type": "userpass", "username": auth_username, "password": password}
        self.aors[extension] = {
            "max_contacts": 1,
            "remove_existing": "yes",
            "default_expiration": session_seconds,
            "maximum_expiration": session_seconds,
        }
        self.endpoints[extension] = {
            "transport": transport,
            "aors": extension,
            "auth": ",".join(auth_ids),
            "context": context,
            "from_domain": from_domain,
            "callerid": f"Extension {extension} <{extension}>",
        }
        for dropped in drop_auth_ids:
            self.auths.pop(dropped, None)

    def update_endpoint_auths(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
        drop_auth_ids: Sequence[str],
    ) -> None:
        payload: dict[str, object] = {
            "extension": extension,
            "auth_ids": list(auth_ids),
            "drop_auth_ids": list(drop_auth_ids),
        }
        self.calls.append(("update_endpoint_auths", payload))
        self._check_failure("update_endpoint_auths")
        if extension in self.endpoints:
            self.endpoints[extension]["auth"] = ",".join(auth_ids)
        for dropped in drop_auth_ids:
            self.auths.pop(dropped, None)

    def delete_extension(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
    ) -> None:
        payload: dict[str, object] = {"extension": extension, "auth_ids": list(auth_ids)}
        self.calls.append(("delete_extension", payload))
        self._check_failure("delete_extension")
        self.endpoints.pop(extension, None)
        self.aors.pop(extension, None)
        for auth_id in auth_ids:
            self.auths.pop(auth_id, None)
        prefix = f"{extension}_"
        for orphan in [key for key in self.auths if key.startswith(prefix)]:
            del self.auths[orphan]

"""The private routes Odoo calls on the agent, authenticated with reverse-direction HMAC-SHA256 (design 12.6).

Every route verifies ``X-Liwan-Telephony-Timestamp``, ``X-Liwan-Telephony-Signature`` and
``X-Liwan-Telephony-Database`` over ``<timestamp>\\n<METHOD>\\n<path>\\n<raw_body>`` using the company's derived
reverse key before inspecting or validating any request payload:

* ``POST /registration`` mints a session password with a unique auth slot and writes the PJSIP objects atomically.
* ``DELETE /registration/{extension}`` revokes all active sessions and removes the extension's PJSIP objects.
* ``PUT /extensions/{extension}`` enables (validation only; no password until ``/registration``) or disables an extension.
* ``DELETE /extensions/{extension}`` disables an extension and removes its PJSIP objects.
* ``POST /recordings/link`` returns a short-lived signed recording URL with bounded clock tolerance.
* ``PUT /recording/config`` writes the company's recording policy row the dialplan reads through Asterisk realtime.
* ``POST /recordings/delete`` deletes the recordings of the calls Odoo is retaining no longer, leaving a live call's file.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import TYPE_CHECKING, Literal, TypeVar

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, ValidationError

from pbx_agent.pbx_db import PbxStoreError
from pbx_agent.recordings import delete_recording, recording_path
from pbx_agent.signing import (
    CALL_ID,
    DATABASE_HEADER,
    EVENT_SIGNATURE_HEADER,
    EVENT_TIMESTAMP_HEADER,
    recording_token,
    verify_reverse_request,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from pbx_agent.pbx_db import PbxStore
    from pbx_agent.sessions import SessionManager
    from pbx_agent.settings import Settings

log = logging.getLogger(__name__)

EXTENSION_NUMBER = re.compile(r"[0-9]{2,10}")
LINK_SECONDS = 60
LINK_CLOCK_TOLERANCE_SECONDS = 300
# One request deletes the recordings of one retention pass; a larger list is refused rather than held in memory.
MAX_RECORDING_DELETIONS = 500

_ModelT = TypeVar("_ModelT", bound=BaseModel)


class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extension: str = Field(pattern=r"^[0-9]{2,10}$")
    database: str = Field(min_length=1, max_length=64)


class RegistrationAnswer(BaseModel):
    ws_url: str
    extension: str
    auth_username: str
    password: str
    ice_servers: list[dict]
    expires_in_seconds: int


class ExtensionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    database: str = Field(min_length=1, max_length=64)
    active: StrictBool


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    linkedid: str = Field(min_length=1, max_length=128)
    database: str = Field(min_length=1, max_length=64)
    expires_at: StrictInt


class RecordingConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    database: str = Field(min_length=1, max_length=64)
    policy: Literal["always", "off"]
    announce: StrictBool


class RecordingDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    database: str = Field(min_length=1, max_length=64)
    linkedids: list[str] = Field(min_length=1, max_length=MAX_RECORDING_DELETIONS)


def _request_path(request: Request) -> str | None:
    """The exact ASCII wire path for HMAC verification, falling back to ``request.url.path``."""
    raw_path = request.scope.get("raw_path")
    if isinstance(raw_path, bytes) and raw_path:
        try:
            return raw_path.decode("ascii")
        except UnicodeDecodeError:
            return None
    return request.url.path


async def _verify_reverse(request: Request, settings: Settings, *, now: float) -> tuple[bytes, str]:
    """Authenticate an Odoo -> pbx-agent request. Returns ``(raw_body, header_database)``."""
    raw_body = await request.body()
    path = _request_path(request)
    timestamp = request.headers.get(EVENT_TIMESTAMP_HEADER)
    signature = request.headers.get(EVENT_SIGNATURE_HEADER)
    database = request.headers.get(DATABASE_HEADER)
    if (
        path is None
        or not database
        or not verify_reverse_request(
            settings.reverse_key,
            timestamp=timestamp,
            signature=signature,
            method=request.method,
            path=path,
            body=raw_body,
            now=now,
        )
    ):
        raise HTTPException(status_code=401)
    if database != settings.database:
        raise HTTPException(status_code=403)
    return raw_body, database


def _parse_body(raw_body: bytes, model_cls: type[_ModelT], settings: Settings, header_database: str) -> _ModelT:
    """Parse and validate a JSON body, enforcing that ``database`` matches both ``settings.database`` and header."""
    try:
        data = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422) from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=422)
    body_db = data.get("database")
    if isinstance(body_db, str) and (body_db != settings.database or body_db != header_database):
        raise HTTPException(status_code=403)
    try:
        return model_cls.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422) from exc


def _require_extension(extension: str) -> str:
    if not EXTENSION_NUMBER.fullmatch(extension):
        raise HTTPException(status_code=422)
    return extension


def _require_call_ids(linkedids: list[str]) -> list[str]:
    """The distinct call ids of a delete request, in request order; any name outside the call-id rule answers 422."""
    if any(CALL_ID.fullmatch(linkedid) is None for linkedid in linkedids):
        raise HTTPException(status_code=422)
    return list(dict.fromkeys(linkedids))


def _delete_recordings(root: Path, linkedids: Sequence[str], live_call: Callable[[str], bool]) -> tuple[list[str], list[str]]:
    """Delete the recordings of the calls Odoo no longer keeps and report what happened to each.

    A call the stream still has a leg of is left alone and reported in neither list: its recording is still being
    written, and Odoo must keep it available. A call without a file is ``missing``, which a repeat of the same
    request reports again instead of failing.
    """
    deleted: list[str] = []
    missing: list[str] = []
    for linkedid in linkedids:
        if live_call(linkedid):
            log.info("recording kept: call %s is live", linkedid)
        elif delete_recording(root, linkedid):
            log.info("recording deleted: call %s", linkedid)
            deleted.append(linkedid)
        else:
            missing.append(linkedid)
    return deleted, missing


def register_odoo_routes(
    app: FastAPI,
    settings: Settings,
    sessions: SessionManager,
    store: PbxStore,
    *,
    live_call: Callable[[str], bool],
    clock: Callable[[], float] = time.time,
) -> None:
    """Mount all private Odoo -> pbx-agent routes on ``app``."""

    @app.post("/registration", response_model=RegistrationAnswer)
    async def registration(request: Request) -> RegistrationAnswer:
        now = clock()
        raw_body, header_db = await _verify_reverse(request, settings, now=now)
        body = _parse_body(raw_body, RegistrationRequest, settings, header_db)
        extension = _require_extension(body.extension)
        try:
            issued = await run_in_threadpool(sessions.issue, extension, now=now)
        except PbxStoreError as error:
            # The browser gets no password when the endpoint could not be written: a registration that cannot work
            # must not look like one that can.
            raise HTTPException(status_code=502) from error
        return RegistrationAnswer(
            ws_url=issued.ws_url,
            extension=issued.extension,
            auth_username=issued.auth_username,
            password=issued.password,
            ice_servers=issued.ice_servers,
            expires_in_seconds=issued.expires_in_seconds,
        )

    @app.delete("/registration/{extension}")
    async def revoke_registration(extension: str, request: Request) -> dict:
        now = clock()
        await _verify_reverse(request, settings, now=now)
        ext = _require_extension(extension)
        try:
            await run_in_threadpool(sessions.revoke, ext)
        except PbxStoreError as error:
            raise HTTPException(status_code=502) from error
        return {"revoked": True, "extension": ext}

    @app.put("/extensions/{extension}")
    async def update_extension(extension: str, request: Request) -> dict:
        now = clock()
        raw_body, header_db = await _verify_reverse(request, settings, now=now)
        body = _parse_body(raw_body, ExtensionUpdateRequest, settings, header_db)
        ext = _require_extension(extension)
        if not body.active:
            try:
                await run_in_threadpool(sessions.revoke, ext)
            except PbxStoreError as error:
                raise HTTPException(status_code=502) from error
            return {"extension": ext, "active": False}
        return {"extension": ext, "active": True}

    @app.delete("/extensions/{extension}")
    async def delete_extension(extension: str, request: Request) -> dict:
        now = clock()
        await _verify_reverse(request, settings, now=now)
        ext = _require_extension(extension)
        try:
            await run_in_threadpool(sessions.revoke, ext)
        except PbxStoreError as error:
            raise HTTPException(status_code=502) from error
        return {"disabled": True, "extension": ext}

    @app.post("/recordings/link")
    async def link(request: Request) -> dict:
        now = clock()
        raw_body, header_db = await _verify_reverse(request, settings, now=now)
        body = _parse_body(raw_body, LinkRequest, settings, header_db)
        now_int = int(now)
        if body.expires_at <= now_int:
            raise HTTPException(status_code=410)
        if body.expires_at > now_int + LINK_SECONDS + LINK_CLOCK_TOLERANCE_SECONDS:
            raise HTTPException(status_code=422)
        if recording_path(settings.recordings_dir, body.linkedid) is None:
            raise HTTPException(status_code=404)
        token_exp = min(body.expires_at, now_int + LINK_SECONDS)
        token = recording_token(
            settings.reverse_key,
            call_id=body.linkedid,
            host=settings.public_host,
            expires_at=token_exp,
        )
        return {
            "url": f"https://{settings.public_host}/pbx/recordings/{token}",
            "expiresInSeconds": token_exp - now_int,
        }

    @app.put("/recording/config")
    async def set_recording_config(request: Request) -> dict:
        now = clock()
        raw_body, header_db = await _verify_reverse(request, settings, now=now)
        body = _parse_body(raw_body, RecordingConfigRequest, settings, header_db)
        try:
            await run_in_threadpool(store.upsert_recording_config, policy=body.policy, announce=body.announce)
        except PbxStoreError as error:
            # Odoo is told the policy did not reach the dialplan instead of being told it did.
            raise HTTPException(status_code=502) from error
        return {"applied": True}

    @app.post("/recordings/delete")
    async def delete_recordings(request: Request) -> dict:
        now = clock()
        raw_body, header_db = await _verify_reverse(request, settings, now=now)
        body = _parse_body(raw_body, RecordingDeleteRequest, settings, header_db)
        linkedids = _require_call_ids(body.linkedids)
        deleted, missing = await run_in_threadpool(_delete_recordings, settings.recordings_dir, linkedids, live_call)
        return {"deleted": deleted, "missing": missing}

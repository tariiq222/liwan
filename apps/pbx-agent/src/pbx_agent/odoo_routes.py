"""The two routes Odoo calls on the agent, authenticated with the reverse-direction company key (design 12.6).

Odoo signs nothing here: the agent and Odoo share one key per company per direction, the route receives the key in a
header, and a mismatch is a 401 that says nothing else. Both routes run on the company's private network, never through
the public edge.

* ``POST /registration`` mints a session password for an extension and writes the endpoint into the Asterisk realtime
  database, so the browser can register with it once (design 4.1).
* ``POST /recordings/link`` returns the signed one-minute URL of a call's recording (design 4.4).
"""

from __future__ import annotations

import hmac
import secrets
import time
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from pbx_agent.ari import AriError
from pbx_agent.recordings import recording_path
from pbx_agent.signing import recording_token

if TYPE_CHECKING:
    from pbx_agent.ari import Ari

KEY_HEADER = "X-Liwan-Key"
SESSION_PASSWORD_BYTES = 18
LINK_SECONDS = 60


class RegistrationRequest(BaseModel):
    extension: str = Field(min_length=1, max_length=32)
    database: str = Field(min_length=1, max_length=64)


class RegistrationAnswer(BaseModel):
    ws_url: str
    extension: str
    password: str
    ice_servers: list[dict]
    expires_in_seconds: int


class LinkRequest(BaseModel):
    linkedid: str = Field(min_length=1, max_length=128)
    database: str = Field(min_length=1, max_length=64)
    expires_at: int


def require_key(request: Request, expected: bytes) -> None:
    """Refuse anything that does not present this company's reverse key. One answer, no detail."""
    presented = request.headers.get(KEY_HEADER, "")
    if not presented or not hmac.compare_digest(presented.encode(), expected.hex().encode()):
        raise HTTPException(status_code=401)


def session_password() -> str:
    """A fresh password per registration: the browser holds it for one session and it is never stored in Odoo."""
    return secrets.token_urlsafe(SESSION_PASSWORD_BYTES)


def registration_route(app, settings, ari: Ari, reverse_key: bytes) -> None:
    @app.post("/registration", response_model=RegistrationAnswer)
    async def registration(body: RegistrationRequest, request: Request) -> RegistrationAnswer:
        require_key(request, reverse_key)
        if body.database != settings.database:
            raise HTTPException(status_code=403)
        password = session_password()
        try:
            await run_in_threadpool(
                ari.upsert_endpoint,
                body.extension,
                password,
                settings.pjsip_transport,
                settings.pjsip_context,
            )
        except AriError as error:
            # The browser gets no password when the endpoint could not be written: a registration that cannot work
            # must not look like one that can.
            raise HTTPException(status_code=502) from error
        return RegistrationAnswer(
            ws_url=settings.public_ws_url,
            extension=body.extension,
            password=password,
            ice_servers=settings.ice_servers,
            expires_in_seconds=settings.session_seconds,
        )


def link_route(app, settings, reverse_key: bytes) -> None:
    @app.post("/recordings/link")
    async def link(body: LinkRequest, request: Request) -> dict:
        require_key(request, reverse_key)
        if body.database != settings.database:
            raise HTTPException(status_code=403)
        if body.expires_at <= int(time.time()):
            raise HTTPException(status_code=410)
        if recording_path(settings.recordings_dir, body.linkedid) is None:
            raise HTTPException(status_code=404)
        token = recording_token(
            reverse_key,
            call_id=body.linkedid,
            host=settings.public_host,
            expires_at=min(body.expires_at, int(time.time()) + LINK_SECONDS),
        )
        return {
            "url": f"https://{settings.public_host}/pbx/recordings/{token}",
            "expiresInSeconds": LINK_SECONDS,
        }

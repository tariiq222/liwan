"""Wire contracts of the service (master plan ع1 and ع2). Validation lives here, nowhere else."""
from __future__ import annotations

import json
import re
from typing import Any, Literal

import jsonschema
from pydantic import BaseModel, ConfigDict, Field, model_validator

ToolKind = Literal["read", "write_light", "draft"]
TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
PAGE_NAME = r"^[a-z][a-z_-]{0,39}$"
MAX_TOOLS = 100
MAX_RESULT_BYTES = 200 * 1024
RUN_STATUSES = ("running", "executing", "waiting_tool", "waiting_user", "done", "failed", "limit_reached")
RunStatusValue = Literal["running", "executing", "waiting_tool", "waiting_user", "done", "failed", "limit_reached"]


def encode_tool_name(name: str) -> str:
    """The provider-legal form of a dotted tool name (providers accept ``[a-zA-Z0-9_-]{1,64}`` only)."""
    return name.replace(".", "__")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolRoute(Strict):
    method: Literal["GET", "POST", "PATCH"]
    path: str = Field(pattern=r"^/api/v1/")


class ToolDescription(Strict):
    ar: str = Field(min_length=1)
    en: str = Field(min_length=1)


class ToolSpec(Strict):
    name: str = Field(pattern=TOOL_NAME.pattern, max_length=63)  # one char longer once encoded, 64 at most
    kind: ToolKind
    description: ToolDescription
    input_schema: dict[str, Any]
    route: ToolRoute | None
    input_map: dict[str, dict[str, Any]] = Field(default_factory=dict)
    result_summary: list[str] = Field(default_factory=list)
    draft_target: str | None = None

    @model_validator(mode="after")
    def _shape_by_kind(self) -> ToolSpec:
        if self.input_schema.get("type") != "object":
            msg = "input_schema must be an object schema"
            raise ValueError(msg)
        try:
            jsonschema.Draft202012Validator.check_schema(self.input_schema)
        except jsonschema.SchemaError as error:
            msg = f"input_schema is not a valid JSON Schema: {error.message}"
            raise ValueError(msg) from error
        if self.kind == "draft":
            if self.route is not None or not self.draft_target:
                msg = "a draft tool has a draft_target and no route"
                raise ValueError(msg)
        elif self.route is None or self.draft_target is not None:
            msg = "a read/write_light tool has a route and no draft_target"
            raise ValueError(msg)
        return self


class Limits(Strict):
    max_steps: int = Field(ge=1, le=50)
    max_tool_calls: int = Field(ge=0, le=50)
    timeout_seconds: int = Field(ge=5, le=600)


class RunContext(Strict):
    page: str = Field(pattern=PAGE_NAME)
    id: int | None = None


class RunRequest(Strict):
    tenant: str = Field(min_length=1, max_length=120)
    user_ref: str = Field(min_length=1, max_length=40)
    locale: Literal["ar", "en"]
    message: str = Field(min_length=1, max_length=8000)
    context: RunContext | None = None
    tools: list[ToolSpec] = Field(max_length=MAX_TOOLS)
    limits: Limits
    run_id: str | None = None

    @model_validator(mode="after")
    def _tool_names_are_unique(self) -> RunRequest:
        names = [tool.name for tool in self.tools]
        if len(set(names)) != len(names):
            msg = "tool names must be unique"
            raise ValueError(msg)
        if len({encode_tool_name(name) for name in names}) != len(names):
            msg = "two tool names collide once encoded for the provider"
            raise ValueError(msg)
        return self


class ToolError(Strict):
    code: str = Field(min_length=1, max_length=60)
    message: str = Field(default="", max_length=2000)


class ToolResult(Strict):
    ok: bool
    data: dict[str, Any] | None = None
    error: ToolError | None = None
    decision: Literal["approved", "rejected"] | None = None

    @model_validator(mode="after")
    def _consistent(self) -> ToolResult:
        if self.data is not None and len(json.dumps(self.data, ensure_ascii=False).encode()) > MAX_RESULT_BYTES:
            msg = f"result data exceeds {MAX_RESULT_BYTES} bytes"
            raise ValueError(msg)
        if self.ok and self.error is not None:
            msg = "an ok result carries no error"
            raise ValueError(msg)
        if not self.ok and self.error is None and self.decision != "rejected":
            msg = "a failed result carries an error or a rejected decision"
            raise ValueError(msg)
        return self


class ResumeRequest(Strict):
    call_id: str = Field(min_length=1, max_length=40)
    result: ToolResult


class ClaimRequest(Strict):
    call_id: str = Field(min_length=1, max_length=40)


class PendingCall(Strict):
    call_id: str
    tool: str
    kind: ToolKind
    input: dict[str, Any]


class RunMessage(Strict):
    role: Literal["user", "assistant"]
    content: str


class RunStatus(Strict):
    run_id: str
    status: RunStatusValue
    messages: list[RunMessage]
    pending: PendingCall | None

"""Wire contracts of the service (master plan ع1 and ع2). Validation lives here, nowhere else."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal

import jsonschema
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

ToolKind = Literal["read", "write_light", "draft"]
# One compatibility contract for ai_runs, graph state and claimed tool-result semantics.
AI_STATE_VERSION = "1"
TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
PAGE_NAME = r"^[a-z][a-z_-]{0,39}$"
MAX_TOOLS = 100
MAX_AGENTS = 50
AGENT_KEY = r"^[a-z][a-z0-9_]*$"
CORE_AGENT = "core"  # the platform coordinator; its instructions are platform constants (prompts.py)
MAX_RESULT_BYTES = 200 * 1024
RUN_TITLE_MAX_CHARS = 80
NEW_RUN_ID = r"^r_[0-9a-f]{24}$"
CALL_ID = r"^[0-9a-f]{16}$"
PROVIDER_NAME = r"^[a-z][a-z0-9_-]{0,31}$"
BASE_URL_MAX_LENGTH = 512
MODEL_NAME = r"^[^\x00-\x1f\x7f-\x9f]{1,128}$"  # the same rule as the Odoo usage ledger and the zod contract
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
    draft_model: str | None = None  # the model an approved draft's record lives in; Odoo verifies the approval against it
    requires_approval: bool = False  # the administrator made this read wait for the user; a write always waits
    platform: bool = False  # a read tool of the platform itself (the knowledge search): no owning agent, offered to every agent

    @property
    def agent(self) -> str | None:
        """The agent that owns the tool: the application id its name starts with; none for a platform tool."""
        if self.platform:
            return None
        return self.name.split(".", 1)[0]

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
            if self.route is not None or not self.draft_target or not self.draft_model:
                msg = "a draft tool has a draft_target, a draft_model and no route"
                raise ValueError(msg)
        elif self.route is None or self.draft_target is not None or self.draft_model is not None:
            msg = "a read/write_light tool has a route and no draft_target or draft_model"
            raise ValueError(msg)
        if self.platform and self.kind != "read":
            msg = "only a read tool is a platform tool"
            raise ValueError(msg)
        return self


class AgentSpec(Strict):
    """One specialist agent as Odoo declares it for this user (spec 2026-11-04 §6.5)."""

    key: str = Field(pattern=AGENT_KEY, max_length=40)
    name: ToolDescription
    description: ToolDescription
    instructions: ToolDescription
    pages: list[str] = Field(default_factory=list, max_length=20)
    memory: bool = True  # the administrator's switch: the agent may save and read employee and company notes

    @field_validator("key")
    @classmethod
    def _not_core(cls, key: str) -> str:
        if key == CORE_AGENT:
            msg = "core is the platform coordinator, not a registered agent"
            raise ValueError(msg)
        return key

    @field_validator("pages")
    @classmethod
    def _page_names(cls, pages: list[str]) -> list[str]:
        if not all(re.match(PAGE_NAME, page) for page in pages):
            msg = "pages must be page names"
            raise ValueError(msg)
        return pages


class Limits(Strict):
    max_steps: int = Field(ge=1, le=50)
    max_tool_calls: int = Field(ge=0, le=50)
    timeout_seconds: int = Field(ge=5, le=600)


# Whose account pays a request: the platform's within the package, the tenant's own key, or the vendor's setup budget
# (the free setup agent runs on the platform provider, spec 2026-11-04 §6.5).
Billing = Literal["platform", "tenant_key", "setup"]
Quality = Literal["economical", "balanced", "best"]  # the tenant's quality level: which column of the vendor's model map a run uses


class Policy(Strict):
    """The tenant's AI policy as Odoo states it for this request (spec 2026-11-04 §6.8); the service enforces it."""

    provider_mode: Billing  # whose account pays the request; "setup" runs on the platform provider
    consent_signed: bool  # the tenant signed the current AI acknowledgement; no provider runs a request without it
    max_output_tokens: int | None = Field(ge=0, le=1_000_000)  # platform runs only; null means no cap, 0 allows no answer
    # The tenant's own ceiling on the summed input tokens of one request (issue #554), in both provider modes. A plan call
    # runs only while the total already spent is under it, so the call that reaches the ceiling completes, its text having
    # streamed, and the next one stops the run with ``limit_reached`` and ``input_tokens``; a tool call it carried is not
    # made. null means no ceiling. 0 refuses even the first call.
    max_input_tokens: int | None = Field(default=None, ge=0, le=2_000_000)
    quality: Quality = "balanced"  # platform runs only: the column of the vendor's model map; a tenant key has one model


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
    agents: list[AgentSpec] = Field(default_factory=list, max_length=MAX_AGENTS)
    company: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,18}$")  # the user's current company, for company notes
    limits: Limits
    policy: Policy
    run_id: str | None = Field(default=None, min_length=1)  # continues this run
    new_run_id: str | None = Field(default=None, pattern=NEW_RUN_ID)  # starts a run under the caller's id

    @model_validator(mode="after")
    def _names_one_run(self) -> RunRequest:
        if (self.run_id is None) == (self.new_run_id is None):
            msg = "send exactly one of run_id (continue a run) and new_run_id (start one)"
            raise ValueError(msg)
        return self

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

    @model_validator(mode="after")
    def _agents_own_the_tools(self) -> RunRequest:
        keys = [agent.key for agent in self.agents]
        if len(set(keys)) != len(keys):
            msg = "agent keys must be unique"
            raise ValueError(msg)
        orphan = next((tool.name for tool in self.tools if not tool.platform and tool.agent not in keys), None)
        if orphan is not None:
            msg = f"tool {orphan} belongs to no agent of the request"
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
    policy: Policy  # the policy now: an acknowledgement revoked while the run waited stops it here


class ClaimRequest(Strict):
    call_id: str = Field(min_length=1, max_length=40)


class PendingCall(Strict):
    call_id: str
    tool: str
    kind: ToolKind
    input: dict[str, Any]
    agent: str = CORE_AGENT  # the agent that asked for it
    requires_approval: bool = False  # true for every write and draft, and for a read the administrator set to approval


class RunMessage(Strict):
    role: Literal["user", "assistant"]
    content: str


class RunStatus(Strict):
    run_id: str
    status: RunStatusValue
    messages: list[RunMessage]
    pending: PendingCall | None


class RunSummary(Strict):
    run_id: str
    title: str | None
    status: RunStatusValue
    updated_at: datetime
    archived: bool


class RunPatch(Strict):
    """A user's rename and/or archive flag (``PATCH /v1/runs/{run_id}``)."""

    title: str | None = None
    archived: bool | None = None

    @field_validator("title")
    @classmethod
    def _title_is_one_clean_line(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not 1 <= len(text) <= RUN_TITLE_MAX_CHARS or any(ord(char) < 32 or ord(char) == 127 for char in text):
            msg = f"title must be 1 to {RUN_TITLE_MAX_CHARS} characters without control characters"
            raise ValueError(msg)
        return text

    @model_validator(mode="after")
    def _changes_something(self) -> RunPatch:
        if self.title is None and self.archived is None:
            msg = "send a title, archived, or both"
            raise ValueError(msg)
        return self


class RunList(Strict):
    items: list[RunSummary]
    total: int


ModelCallKind = Literal["plan", "title", "route", "summary"]
# ``route`` classifies each new message and the plan calls of that message follow it; ``summary`` rewrites the rolling summary of a long conversation.
# What kind of task a call served.
Capability = Literal["quick", "standard", "analysis", "writing"]
# Cost units are 0.00001 USD; the bound is the largest value of Odoo's integer column.
MAX_COST_UNITS = 2_147_483_647
ModelCallOutcome = Literal["ok", "failed", "retried", "aborted"]


class ModelCallEvent(Strict):
    """``model_call``: a provider attempt is about to start (service to the Nuxt server only, never to the browser)."""

    call_id: str = Field(pattern=CALL_ID)
    kind: ModelCallKind
    capability: Capability
    billing: Billing
    provider: str = Field(pattern=PROVIDER_NAME)
    model: str = Field(pattern=MODEL_NAME)
    called_at: AwareDatetime


class ModelUsageEvent(Strict):
    """``model_usage``: how the attempt ``call_id`` ended; both token counts are set, or both are null.

    ``cost`` (what the call cost the vendor) and ``charge`` (cost plus the vendor margin) are in cost units of 0.00001 USD. Both are
    null without token counts; ``charge`` is also null where the vendor pays for the call (``setup``) or the tenant's own key does.
    """

    call_id: str = Field(pattern=CALL_ID)
    outcome: ModelCallOutcome
    input_tokens: int | None = Field(ge=0, le=100_000_000)
    output_tokens: int | None = Field(ge=0, le=100_000_000)
    cost: int | None = Field(ge=0, le=MAX_COST_UNITS)
    charge: int | None = Field(ge=0, le=MAX_COST_UNITS)

    @model_validator(mode="after")
    def _tokens_come_in_pairs(self) -> ModelUsageEvent:
        if (self.input_tokens is None) != (self.output_tokens is None):
            msg = "input_tokens and output_tokens are both set or both null"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _cost_follows_tokens(self) -> ModelUsageEvent:
        if self.cost is not None and self.input_tokens is None:
            msg = "cost needs token counts"
            raise ValueError(msg)
        if self.charge is not None and self.cost is None:
            msg = "charge needs a cost"
            raise ValueError(msg)
        return self


class RetentionPut(Strict):
    retention_days: int = Field(ge=1, le=365)


class LeaverRetentionPut(Strict):
    leaver_retention_days: int = Field(ge=0, le=365)


class NoteView(Strict):
    id: int
    content: str
    created_at: datetime


class NoteList(Strict):
    items: list[NoteView]
    total: int


class CompanyNoteView(Strict):
    id: int
    content: str
    status: Literal["proposed", "approved"]
    proposed_by: str | None
    created_at: datetime


class CompanyNoteList(Strict):
    items: list[CompanyNoteView]
    total: int


class KeyPut(Strict):
    provider: str = Field(pattern=PROVIDER_NAME)
    model: str = Field(pattern=MODEL_NAME)
    api_key: str = Field(min_length=1, max_length=512)
    base_url: str | None = Field(default=None, max_length=BASE_URL_MAX_LENGTH)  # required for a provider that needs one, refused for the rest


class KeyView(Strict):
    configured: bool
    provider: str | None
    model: str | None
    last4: str | None
    updated_at: AwareDatetime | None
    base_url: str | None


class ProviderView(Strict):
    name: str
    needs_api_key: bool
    needs_base_url: bool


class PlatformView(Strict):
    provider: str
    model: str


class TenantConfigView(Strict):
    """``GET /v1/tenant/config``: never the key itself, only whether one is set and its last four characters."""

    retention_days: int
    leaver_retention_days: int
    key: KeyView
    platform: PlatformView
    providers: list[ProviderView]

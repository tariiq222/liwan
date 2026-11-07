from dataclasses import replace

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

from liwan_ai_service.platform_provider import PlatformProvider
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.providers import build_platform_model, build_tenant_model
from liwan_ai_service.settings import Settings
from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
from tests.platform_file import platform_env

SETTINGS = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})


def build(provider, *, api_key="k", base_url=None, model="m", stream_usage=None, **attribution):
    """The platform model for these file fields; a provider that needs an endpoint gets one unless the test gives it."""
    if base_url is None and provider in REGISTRY and REGISTRY[provider].needs_base_url:
        base_url = "https://llm.example.com/v1"
    return build_platform_model(replace(SETTINGS, **attribution), PlatformProvider(provider, model, base_url, api_key, 1, stream_usage))


def test_each_provider_builds_its_client_without_network():
    anthropic = build("anthropic")
    openai = build("openai", base_url="http://proxy/v1")
    ollama = build("ollama", api_key=None, base_url="http://ollama:11434")
    assert type(anthropic).__name__ == "ChatAnthropic"
    assert type(openai).__name__ == "ChatOpenAI"
    assert type(ollama).__name__ == "ChatOllama"


def test_the_registry_is_the_single_source_of_provider_names():
    assert set(REGISTRY) == {"anthropic", "openai", "ollama", "openrouter", "openai_compatible"}
    assert all(name == spec.name for name, spec in REGISTRY.items())


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_every_registered_provider_builds_without_network(name):
    model = build(name)
    assert isinstance(model, BaseChatModel)


def test_openrouter_defaults_to_its_endpoint_and_honours_the_override():
    default = build("openrouter", model="anthropic/claude-sonnet-4.5")
    assert type(default).__name__ == "ChatOpenAI"
    assert default.openai_api_base == "https://openrouter.ai/api/v1"
    override = build("openrouter", base_url="http://proxy/v1")
    assert override.openai_api_base == "http://proxy/v1"


def test_openrouter_attribution_headers_are_sent_only_when_set():
    bare = build("openrouter")
    assert not bare.default_headers
    referer_only = build("openrouter", openrouter_referer="https://liwan.example")
    assert referer_only.default_headers == {"HTTP-Referer": "https://liwan.example"}
    both = build("openrouter", openrouter_referer="https://liwan.example", openrouter_title="LiwanOS")
    assert both.default_headers == {"HTTP-Referer": "https://liwan.example", "X-Title": "LiwanOS"}


async def test_scripted_model_replays_and_streams():
    model = ScriptedChatModel([ai_tool_call("pmo.list_my_tasks", {"limit": 5}, "c_1"), ai_text("تم")])
    bound = model.bind_tools([{"type": "function", "function": {"name": "pmo.list_my_tasks", "parameters": {"type": "object"}}}])
    assert bound is model and model.bound_tools[0]["function"]["name"] == "pmo.list_my_tasks"
    first = await model.ainvoke([HumanMessage("hi")])
    assert first.tool_calls[0]["name"] == "pmo.list_my_tasks"
    chunks = [chunk.content async for chunk in model.astream([HumanMessage("hi")])]
    assert "".join(chunks) == "تم"
    with pytest.raises(RuntimeError, match="script exhausted"):
        await model.ainvoke([HumanMessage("again")])


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_the_sdks_never_retry_on_their_own_so_the_service_reports_every_attempt(name):
    model = build(name)
    if name != "ollama":  # the Ollama client has no retries
        assert model.max_retries == 0


def test_stream_usage_is_asked_only_of_endpoints_known_to_accept_it():
    assert build("openai").stream_usage is True
    assert build("openai", base_url="http://proxy/v1").stream_usage is False  # a compatible server may refuse stream_options
    assert build("openrouter").stream_usage is True


def test_the_generic_provider_reports_no_tokens_it_may_not_support():
    model = build("openai_compatible")
    assert type(model).__name__ == "ChatOpenAI" and model.openai_api_base == "https://llm.example.com/v1"
    assert model.stream_usage is False  # a compatible server may refuse stream_options


def test_the_platform_file_decides_whether_a_custom_endpoint_is_asked_for_token_counts():
    assert build("openai_compatible").stream_usage is False  # not stated: the old rule, a custom endpoint is not asked
    assert build("openai_compatible", stream_usage=True).stream_usage is True
    assert build("openai_compatible", stream_usage=False).stream_usage is False
    assert build("openai", stream_usage=True, base_url="https://proxy.example/v1").stream_usage is True
    assert build("openai").stream_usage is True and build("openai", stream_usage=False).stream_usage is False
    assert build("openrouter").stream_usage is True and build("openrouter", stream_usage=False).stream_usage is False


def test_a_tenant_key_keeps_its_own_rule_whatever_the_platform_file_says():
    tenant = build_tenant_model(SETTINGS, "openai_compatible", "m", "k", "https://llm.tenant.example/v1")
    assert tenant.stream_usage is False
    assert build_tenant_model(SETTINGS, "openai", "m", "k").stream_usage is True
    assert build_tenant_model(SETTINGS, "openrouter", "m", "k").stream_usage is True


def test_the_platform_model_uses_its_own_endpoint_and_anthropic_ignores_any():
    assert build("ollama", api_key=None, base_url=None).base_url == "http://localhost:11434"
    assert build("openrouter", base_url="https://proxy.example/v1").openai_api_base == "https://proxy.example/v1"


def test_a_tenant_model_uses_the_tenants_base_url_only_for_the_generic_provider():
    base = SETTINGS
    generic = build_tenant_model(base, "openai_compatible", "m", "k", "https://llm.tenant.example/v1")
    assert generic.openai_api_base == "https://llm.tenant.example/v1"
    named = build_tenant_model(base, "openrouter", "m", "k", "https://ignored.example/v1")
    assert named.openai_api_base == "https://openrouter.ai/api/v1"
    assert build_tenant_model(base, "openai", "m", "k").openai_api_base is None

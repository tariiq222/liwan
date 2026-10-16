import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
from webvue_ai_service.provider_registry import REGISTRY
from webvue_ai_service.providers import build_chat_model
from webvue_ai_service.settings import Settings, SettingsError


def settings(provider, **extra):
    env = {"AI_PROVIDER": provider, "AI_MODEL": "m", "AI_ALLOW_MEMORY_STATE": "true", **extra}
    return Settings.from_env(env)


def test_each_provider_builds_its_client_without_network():
    anthropic = build_chat_model(settings("anthropic", AI_API_KEY="k"))
    openai = build_chat_model(settings("openai", AI_API_KEY="k", AI_BASE_URL="http://proxy/v1"))
    ollama = build_chat_model(settings("ollama", AI_BASE_URL="http://ollama:11434"))
    assert type(anthropic).__name__ == "ChatAnthropic"
    assert type(openai).__name__ == "ChatOpenAI"
    assert type(ollama).__name__ == "ChatOllama"


def test_the_registry_is_the_single_source_of_provider_names():
    assert set(REGISTRY) == {"anthropic", "openai", "ollama", "openrouter"}
    assert all(name == spec.name for name, spec in REGISTRY.items())


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_every_registered_provider_builds_without_network(name):
    model = build_chat_model(settings(name, AI_API_KEY="k"))
    assert isinstance(model, BaseChatModel)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_a_key_is_required_exactly_for_providers_that_need_one(name):
    if REGISTRY[name].needs_api_key:
        with pytest.raises(SettingsError) as error:
            settings(name)
        assert error.value.variable == "AI_API_KEY"
    else:
        assert settings(name).api_key is None


def test_an_unknown_provider_is_rejected_listing_the_valid_names():
    with pytest.raises(SettingsError) as error:
        settings("gemini")
    assert error.value.variable == "AI_PROVIDER"
    assert all(name in str(error.value) for name in REGISTRY)


def test_openrouter_defaults_to_its_endpoint_and_honours_the_override():
    default = build_chat_model(settings("openrouter", AI_API_KEY="k", AI_MODEL="anthropic/claude-sonnet-4.5"))
    assert type(default).__name__ == "ChatOpenAI"
    assert default.openai_api_base == "https://openrouter.ai/api/v1"
    override = build_chat_model(settings("openrouter", AI_API_KEY="k", AI_BASE_URL="http://proxy/v1"))
    assert override.openai_api_base == "http://proxy/v1"


def test_openrouter_attribution_headers_are_sent_only_when_set():
    bare = build_chat_model(settings("openrouter", AI_API_KEY="k"))
    assert not bare.default_headers
    referer_only = build_chat_model(settings("openrouter", AI_API_KEY="k", AI_OPENROUTER_REFERER="https://webvue.example"))
    assert referer_only.default_headers == {"HTTP-Referer": "https://webvue.example"}
    both = build_chat_model(settings("openrouter", AI_API_KEY="k", AI_OPENROUTER_REFERER="https://webvue.example", AI_OPENROUTER_TITLE="WebVue"))
    assert both.default_headers == {"HTTP-Referer": "https://webvue.example", "X-Title": "WebVue"}


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

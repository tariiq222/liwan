import pytest
from langchain_core.messages import HumanMessage

from nasq_ai_service.providers import build_chat_model
from nasq_ai_service.settings import Settings
from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call


def settings(provider, **extra):
    env = {"AI_PROVIDER": provider, "AI_MODEL": "m", **extra}
    return Settings.from_env(env)


def test_each_provider_builds_its_client_without_network():
    anthropic = build_chat_model(settings("anthropic", AI_API_KEY="k"))
    openai = build_chat_model(settings("openai", AI_API_KEY="k", AI_BASE_URL="http://proxy/v1"))
    ollama = build_chat_model(settings("ollama", AI_BASE_URL="http://ollama:11434"))
    assert type(anthropic).__name__ == "ChatAnthropic"
    assert type(openai).__name__ == "ChatOpenAI"
    assert type(ollama).__name__ == "ChatOllama"


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

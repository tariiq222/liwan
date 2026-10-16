import pytest

from nasq_ai_service.settings import CleanupSettings, Settings, SettingsError


def test_settings_from_env_reads_the_provider_and_defaults():
    settings = Settings.from_env({
        "AI_PROVIDER": "ollama", "AI_MODEL": "qwen2.5:7b", "AI_BASE_URL": "http://ollama:11434",
        "AI_DATABASE_URL": "postgresql://ai:ai@db/ai",
    })
    assert settings.provider == "ollama"
    assert settings.model == "qwen2.5:7b"
    assert settings.base_url == "http://ollama:11434"
    assert settings.api_key is None
    assert settings.default_timeout_seconds == 120


def test_cloud_provider_requires_an_api_key():
    with pytest.raises(ValueError, match="AI_API_KEY"):
        Settings.from_env({"AI_PROVIDER": "anthropic", "AI_MODEL": "claude-sonnet-4-5"})


def test_unknown_provider_is_rejected():
    with pytest.raises(ValueError, match="AI_PROVIDER"):
        Settings.from_env({"AI_PROVIDER": "gemini", "AI_MODEL": "x"})


def test_cleanup_settings_need_only_the_database_and_the_window():
    settings = CleanupSettings.from_env({"AI_DATABASE_URL": "postgresql://ai@db/ai"})
    assert settings.database_url == "postgresql://ai@db/ai" and settings.retention_days == 30
    assert CleanupSettings.from_env({"AI_DATABASE_URL": "postgresql://ai@db/ai", "AI_RUN_RETENTION_DAYS": "7"}).retention_days == 7


def test_cleanup_settings_require_the_database():
    with pytest.raises(SettingsError) as error:
        CleanupSettings.from_env({})
    assert error.value.variable == "AI_DATABASE_URL"


@pytest.mark.parametrize("days", ["0", "-3", "soon", ""])
def test_retention_must_be_at_least_one_day(days):
    with pytest.raises(SettingsError) as error:
        CleanupSettings.from_env({"AI_DATABASE_URL": "postgresql://ai@db/ai", "AI_RUN_RETENTION_DAYS": days})
    assert error.value.variable == "AI_RUN_RETENTION_DAYS"

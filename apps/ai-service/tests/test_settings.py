import pytest

from liwan_ai_service.settings import CleanupSettings, Settings, SettingsError, bootstrap_retention_days


def test_settings_from_env_reads_the_provider_and_defaults():
    settings = Settings.from_env({
        "AI_PROVIDER": "ollama", "AI_MODEL": "qwen2.5:7b", "AI_BASE_URL": "http://ollama:11434",
        "AI_DATABASE_URL": "postgresql://ai:ai@db/ai", "AI_SERVICE_TOKEN": "t" * 30, "AI_TENANT_DATABASE": "acme_db",
    })
    assert settings.provider == "ollama"
    assert settings.model == "qwen2.5:7b"
    assert settings.base_url == "http://ollama:11434"
    assert settings.api_key is None
    assert settings.default_timeout_seconds == 120
    assert settings.tenancy_mode == "dedicated" and settings.tenant_database == "acme_db"


def test_cloud_provider_requires_an_api_key():
    with pytest.raises(ValueError, match="AI_API_KEY"):
        Settings.from_env({"AI_PROVIDER": "anthropic", "AI_MODEL": "claude-sonnet-4-5"})


def test_unknown_provider_is_rejected():
    with pytest.raises(ValueError, match="AI_PROVIDER"):
        Settings.from_env({"AI_PROVIDER": "gemini", "AI_MODEL": "x"})


def test_cleanup_settings_need_only_the_database():
    settings = CleanupSettings.from_env({"AI_DATABASE_URL": "postgresql://ai@db/ai", "AI_RUN_RETENTION_DAYS": "7"})
    assert settings == CleanupSettings(database_url="postgresql://ai@db/ai")  # each tenant's window is its own


def test_a_new_tenant_starts_with_the_deployment_window():
    assert bootstrap_retention_days({}) == 30
    assert bootstrap_retention_days({"AI_RUN_RETENTION_DAYS": "7"}) == 7


def test_cleanup_settings_require_the_database():
    with pytest.raises(SettingsError) as error:
        CleanupSettings.from_env({})
    assert error.value.variable == "AI_DATABASE_URL"


@pytest.mark.parametrize("days", ["0", "-3", "366", "soon", ""])
def test_retention_must_be_one_day_to_a_year(days):
    with pytest.raises(SettingsError) as error:
        bootstrap_retention_days({"AI_RUN_RETENTION_DAYS": days})
    assert error.value.variable == "AI_RUN_RETENTION_DAYS"


ENV = {"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_SERVICE_TOKEN": "t" * 30}


@pytest.mark.parametrize("flag", [None, "", "True", "1", "yes", "false"])
def test_a_missing_database_stops_the_boot_unless_memory_state_is_exactly_true(flag):
    with pytest.raises(ValueError, match="AI_DATABASE_URL is required") as error:
        Settings.from_env({**ENV, **({"AI_ALLOW_MEMORY_STATE": flag} if flag is not None else {})})
    assert str(error.value) == "AI_DATABASE_URL is required (set AI_ALLOW_MEMORY_STATE=true only for local development)"


def test_memory_state_is_allowed_only_when_asked_for():
    assert Settings.from_env({**ENV, "AI_ALLOW_MEMORY_STATE": "true"}).database_url is None
    real = {**ENV, "AI_DATABASE_URL": "postgresql://ai@db/ai", "AI_TENANT_DATABASE": "acme_db"}
    assert Settings.from_env(real).database_url == "postgresql://ai@db/ai"


def test_token_required_without_dev_flag():
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**ENV, "AI_DATABASE_URL": "postgresql://x/liwan_ai", "AI_TENANT_DATABASE": "acme_db"} | {"AI_SERVICE_TOKEN": ""})
    assert error.value.variable == "AI_SERVICE_TOKEN"


def test_dev_flag_allows_missing_token():
    settings = Settings.from_env({
        "AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_DEV_INSECURE": "true", "AI_ALLOW_MEMORY_STATE": "true",
    })
    assert settings.service_token is None


def test_dev_flag_refused_with_database():
    with pytest.raises(SettingsError) as error:
        Settings.from_env({
            "AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_DEV_INSECURE": "true",
            "AI_ALLOW_MEMORY_STATE": "true", "AI_DATABASE_URL": "postgresql://x/liwan_ai",
        })
    assert error.value.variable == "AI_DEV_INSECURE"


def test_incompatible_state_contract_fails_before_opening_state():
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**ENV, "AI_ALLOW_MEMORY_STATE": "true", "AI_STATE_VERSION": "future"})
    assert error.value.variable == "AI_STATE_VERSION"


def test_generation_identity_is_explicit_and_validated():
    env = {**ENV, "AI_ALLOW_MEMORY_STATE": "true"}
    assert Settings.from_env({**env, "AI_GENERATION_ID": "green-ai"}).generation_id == "green-ai"
    assert Settings.from_env(env).generation_id is None
    for generation in ("", "../old", "blue\nsecret", "UPPER"):
        with pytest.raises(SettingsError) as error:
            Settings.from_env({**env, "AI_GENERATION_ID": generation})
        assert error.value.variable == "AI_GENERATION_ID"


@pytest.mark.parametrize("model", ["a\nb", "a\x00b", "a\x7fb", "a\x85b", "a\x9fb", "x" * 129])
def test_a_model_name_the_usage_ledger_would_refuse_stops_the_boot(model):
    with pytest.raises(SettingsError) as error:
        Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": model, "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})
    assert error.value.variable == "AI_MODEL"


def test_the_longest_model_name_and_a_unicode_one_boot():
    for model in ("x" * 128, "نموذج-١"):
        assert Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": model, "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"}).model == model


def test_every_registered_provider_name_fits_the_usage_ledger_rule():
    import re

    from liwan_ai_service.contracts import PROVIDER_NAME
    from liwan_ai_service.provider_registry import REGISTRY

    assert all(re.fullmatch(PROVIDER_NAME, name) for name in REGISTRY)

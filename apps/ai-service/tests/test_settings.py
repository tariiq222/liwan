import pytest

from liwan_ai_service.embeddings import build_embedder
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, CleanupSettings, EmbeddingSettings, Settings, SettingsError, bootstrap_retention_days
from tests.platform_file import platform_env


def test_settings_from_env_reads_the_platform_provider_file_and_defaults():
    settings = Settings.from_env({
        **platform_env("ollama", "qwen2.5:7b", base_url="http://ollama:11434"),
        "AI_DATABASE_URL": "postgresql://ai:ai@db/ai", "AI_SERVICE_TOKEN": "t" * 30, "AI_TENANT_DATABASE": "acme_db",
    })
    assert settings.platform_provider_file.endswith(".json")
    assert settings.default_timeout_seconds == 120
    assert settings.tenancy_mode == "dedicated" and settings.tenant_database == "acme_db"


def test_the_platform_provider_file_is_required_and_the_old_variables_are_not_read():
    for environ in ({}, {PLATFORM_PROVIDER_FILE: "  "}, {"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_API_KEY": "k", "AI_BASE_URL": "http://o:1"}):
        with pytest.raises(SettingsError) as error:
            Settings.from_env({**environ, "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})
        assert error.value.variable == PLATFORM_PROVIDER_FILE


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


ENV = {**platform_env(), "AI_SERVICE_TOKEN": "t" * 30}


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
    settings = Settings.from_env({**platform_env(), "AI_DEV_INSECURE": "true", "AI_ALLOW_MEMORY_STATE": "true"})
    assert settings.service_token is None


def test_dev_flag_refused_with_database():
    with pytest.raises(SettingsError) as error:
        Settings.from_env({
            **platform_env(), "AI_DEV_INSECURE": "true",
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


def test_every_registered_provider_name_fits_the_usage_ledger_rule():
    import re

    from liwan_ai_service.contracts import PROVIDER_NAME
    from liwan_ai_service.provider_registry import REGISTRY

    assert all(re.fullmatch(PROVIDER_NAME, name) for name in REGISTRY)


EMBEDDING = {"AI_EMBEDDING_PROVIDER": "openai", "AI_EMBEDDING_MODEL": "text-embedding-3-small", "AI_EMBEDDING_API_KEY": "k"}


def test_embeddings_are_off_unless_a_provider_is_set():
    assert EmbeddingSettings.from_env({}) is None
    assert Settings.from_env({**ENV, "AI_ALLOW_MEMORY_STATE": "true"}).embedding is None


def test_an_embedding_provider_is_read_with_its_model_endpoint_and_key():
    settings = EmbeddingSettings.from_env({**EMBEDDING, "AI_EMBEDDING_BASE_URL": "http://vllm:8000/v1"})
    assert settings == EmbeddingSettings("openai", "text-embedding-3-small", "http://vllm:8000/v1", "k")
    local = EmbeddingSettings.from_env({"AI_EMBEDDING_PROVIDER": "ollama", "AI_EMBEDDING_MODEL": "bge-m3"})
    assert local == EmbeddingSettings("ollama", "bge-m3", None, None)  # a local model needs no key
    assert Settings.from_env({**ENV, "AI_ALLOW_MEMORY_STATE": "true", **EMBEDDING}).embedding.model == "text-embedding-3-small"


@pytest.mark.parametrize(("environ", "variable"), [
    ({"AI_EMBEDDING_PROVIDER": "gemini", "AI_EMBEDDING_MODEL": "m"}, "AI_EMBEDDING_PROVIDER"),
    ({"AI_EMBEDDING_MODEL": "m"}, "AI_EMBEDDING_PROVIDER"),  # a half-written configuration stops the boot
    ({"AI_EMBEDDING_API_KEY": "k"}, "AI_EMBEDDING_PROVIDER"),
    ({"AI_EMBEDDING_PROVIDER": "openai", "AI_EMBEDDING_API_KEY": "k"}, "AI_EMBEDDING_MODEL"),
    ({"AI_EMBEDDING_PROVIDER": "openai", "AI_EMBEDDING_MODEL": "m"}, "AI_EMBEDDING_API_KEY"),
    ({**EMBEDDING, "AI_EMBEDDING_BASE_URL": "vllm:8000"}, "AI_EMBEDDING_BASE_URL"),
])
def test_a_bad_embedding_configuration_names_its_variable(environ, variable):
    with pytest.raises(SettingsError) as error:
        EmbeddingSettings.from_env(environ)
    assert error.value.variable == variable


def test_the_embedder_is_built_from_the_settings_without_a_network_call():
    assert build_embedder(None) is None
    openai = build_embedder(EmbeddingSettings.from_env({**EMBEDDING, "AI_EMBEDDING_BASE_URL": "http://vllm:8000/v1"}))
    assert openai.model_id == "openai:text-embedding-3-small" and openai.embeddings.check_embedding_ctx_length is False
    ollama = build_embedder(EmbeddingSettings.from_env({"AI_EMBEDDING_PROVIDER": "ollama", "AI_EMBEDDING_MODEL": "bge-m3"}))
    assert ollama.model_id == "ollama:bge-m3"

"""The tenant directory: deployment config maps a tenant to its own database, and nothing else does."""
import json

import pytest

from liwan_ai_service.settings import Settings, SettingsError
from liwan_ai_service.tenancy import (
    DATABASE_NAME,
    DedicatedDirectory,
    MemoryDirectory,
    RegistryDirectory,
    UnknownTenant,
    directory_from_env,
)

TENANT = {"host": "t1.example.sa", "tenantId": "t_1", "database": "acme_db", "filestore": "acme_db", "enabled": True, "registryRevision": 1}


def write_registry(path, targets, *, snapshot_revision=1, schema_version=1):
    path.write_text(json.dumps({"schemaVersion": schema_version, "snapshotRevision": snapshot_revision, "targets": targets}), encoding="utf-8")
    return str(path)


def test_dedicated_maps_only_its_database():
    directory = DedicatedDirectory("acme")
    assert directory.database_for("acme") == "acme"
    assert directory.databases() == ["acme"]
    with pytest.raises(UnknownTenant):
        directory.database_for("other")
    for bad in ("Acme", "x;drop", "", "9lives", "a" * 64):
        with pytest.raises(ValueError):
            DedicatedDirectory(bad)


def test_registry_maps_tenant_to_database(tmp_path):
    directory = RegistryDirectory(write_registry(tmp_path / "registry.json", [TENANT]))
    assert directory.database_for("t_1") == "acme_db"
    assert directory.databases() == ["acme_db"]


def test_registry_skips_disabled_targets(tmp_path):
    disabled = {**TENANT, "host": "t2.example.sa", "tenantId": "t_2", "database": "beta_db", "filestore": "beta_db", "enabled": False}
    directory = RegistryDirectory(write_registry(tmp_path / "registry.json", [TENANT, disabled]))
    assert directory.databases() == ["acme_db"]
    with pytest.raises(UnknownTenant):
        directory.database_for("t_2")


def test_registry_unknown_tenant_raises(tmp_path):
    directory = RegistryDirectory(write_registry(tmp_path / "registry.json", [TENANT]))
    for unknown in ("t_2", "", "../../etc/passwd"):
        with pytest.raises(UnknownTenant):
            directory.database_for(unknown)


def test_registry_rejects_bad_database_name(tmp_path):
    injection = {**TENANT, "host": "t2.example.sa", "tenantId": "t_2", "database": "Acme;drop", "filestore": "Acme;drop"}
    directory = RegistryDirectory(write_registry(tmp_path / "registry.json", [TENANT, injection]))
    with pytest.raises(UnknownTenant):
        directory.database_for("t_2")
    assert directory.databases() == ["acme_db"]
    assert not DATABASE_NAME.fullmatch("Acme;drop")


def test_registry_denies_while_pending(tmp_path):
    path = write_registry(tmp_path / "registry.json", [TENANT])
    (tmp_path / "registry.json.pending").write_text("", encoding="utf-8")
    directory = RegistryDirectory(path)
    with pytest.raises(UnknownTenant):
        directory.database_for("t_1")
    assert directory.databases() == []


def test_registry_reads_current_file(tmp_path):
    path = tmp_path / "registry.json"
    directory = RegistryDirectory(write_registry(path, [TENANT]))
    later = {**TENANT, "host": "t3.example.sa", "tenantId": "t_3", "database": "gamma_db", "filestore": "gamma_db"}
    write_registry(path, [TENANT, later], snapshot_revision=2)
    assert directory.database_for("t_3") == "gamma_db"
    assert directory.databases() == ["acme_db", "gamma_db"]
    with pytest.raises(UnknownTenant):  # a missing file denies, it never serves a stale snapshot
        RegistryDirectory(str(tmp_path / "absent.json")).database_for("t_1")


def test_memory_directory_maps_a_well_formed_tenant_to_itself():
    directory = MemoryDirectory()
    assert directory.databases() == []
    assert directory.database_for("acme") == "acme"
    assert directory.databases() == ["acme"]
    with pytest.raises(UnknownTenant):
        directory.database_for("Acme")
    assert directory_from_env({"AI_ALLOW_MEMORY_STATE": "true"}).database_for("acme") == "acme"


def test_settings_shared_requires_registry_path():
    env = {"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_DATABASE_URL": "postgresql://ai@db/liwan_ai", "AI_SERVICE_TOKEN": "t" * 30}
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**env, "LIWAN_TENANCY_MODE": "shared"})
    assert error.value.variable == "LIWAN_TENANT_REGISTRY_PATH"
    settings = Settings.from_env({**env, "LIWAN_TENANCY_MODE": "shared", "LIWAN_TENANT_REGISTRY_PATH": "/etc/liwan/registry.json"})
    assert (settings.tenancy_mode, settings.tenant_registry_path, settings.tenant_database) == ("shared", "/etc/liwan/registry.json", None)
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**env, "LIWAN_TENANCY_MODE": "hybrid"})
    assert error.value.variable == "LIWAN_TENANCY_MODE"


def test_settings_dedicated_requires_tenant_database():
    env = {"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_DATABASE_URL": "postgresql://ai@db/liwan_ai", "AI_SERVICE_TOKEN": "t" * 30}
    with pytest.raises(SettingsError) as error:
        Settings.from_env(env)
    assert error.value.variable == "AI_TENANT_DATABASE"
    for bad in ("Acme", "x;drop"):
        with pytest.raises(SettingsError) as error:
            Settings.from_env({**env, "AI_TENANT_DATABASE": bad})
        assert error.value.variable == "AI_TENANT_DATABASE"
    settings = Settings.from_env({**env, "AI_TENANT_DATABASE": "acme_db"})
    assert (settings.tenancy_mode, settings.tenant_database) == ("dedicated", "acme_db")
    assert isinstance(directory_from_env({**env, "AI_TENANT_DATABASE": "acme_db"}), DedicatedDirectory)
    # Memory state (no AI_DATABASE_URL) needs no directory configuration at all.
    memory = Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})
    assert memory.tenant_database is None and memory.tenant_registry_path is None

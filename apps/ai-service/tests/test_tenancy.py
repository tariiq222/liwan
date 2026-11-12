"""The tenant directory: deployment config maps a tenant to its own database, and nothing else does."""
import json
import os
from pathlib import Path

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
from tests.platform_file import platform_env

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
    env = {**platform_env(), "AI_DATABASE_URL": "postgresql://ai@db/liwan_ai", "AI_SERVICE_TOKEN": "t" * 30}
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**env, "LIWAN_TENANCY_MODE": "shared"})
    assert error.value.variable == "LIWAN_TENANT_REGISTRY_PATH"
    settings = Settings.from_env({**env, "LIWAN_TENANCY_MODE": "shared", "LIWAN_TENANT_REGISTRY_PATH": "/etc/liwan/registry.json"})
    assert (settings.tenancy_mode, settings.tenant_registry_path, settings.tenant_database) == ("shared", "/etc/liwan/registry.json", None)
    with pytest.raises(SettingsError) as error:
        Settings.from_env({**env, "LIWAN_TENANCY_MODE": "hybrid"})
    assert error.value.variable == "LIWAN_TENANCY_MODE"


def test_settings_dedicated_requires_tenant_database():
    env = {**platform_env(), "AI_DATABASE_URL": "postgresql://ai@db/liwan_ai", "AI_SERVICE_TOKEN": "t" * 30}
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
    memory = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})
    assert memory.tenant_database is None and memory.tenant_registry_path is None


def test_directory_for_uses_validated_settings_not_the_process_environment(tmp_path):
    from liwan_ai_service.tenancy import RegistryDirectory, directory_for

    assert isinstance(directory_for(None, "shared", None, None), MemoryDirectory)
    assert isinstance(directory_for("postgresql://ai@db/ai", "dedicated", "acme_db", None), DedicatedDirectory)
    assert isinstance(directory_for("postgresql://ai@db/ai", "shared", None, str(tmp_path / "r.json")), RegistryDirectory)


def count_reads(monkeypatch):
    reads = []
    original = Path.read_text

    def counting(self, *args, **kwargs):
        reads.append(self)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting)
    return reads


def test_registry_is_parsed_once_per_publication(tmp_path, monkeypatch):
    path = tmp_path / "registry.json"
    directory = RegistryDirectory(write_registry(path, [TENANT]))
    reads = count_reads(monkeypatch)
    for _ in range(1000):
        assert directory.database_for("t_1") == "acme_db"
    assert directory.databases() == ["acme_db"]
    assert len(reads) == 1


def test_registry_disable_and_removal_apply_to_the_next_call(tmp_path, monkeypatch):
    path = tmp_path / "registry.json"
    later = {**TENANT, "host": "t3.example.sa", "tenantId": "t_3", "database": "gamma_db", "filestore": "gamma_db"}
    directory = RegistryDirectory(write_registry(path, [TENANT, later]))
    reads = count_reads(monkeypatch)
    assert directory.database_for("t_3") == "gamma_db"
    write_registry(path, [TENANT, {**later, "enabled": False}], snapshot_revision=2)
    with pytest.raises(UnknownTenant):
        directory.database_for("t_3")
    replacement = tmp_path / "next.json"  # an atomic publication: a new inode renamed over the old one
    write_registry(replacement, [later], snapshot_revision=3)
    os.replace(replacement, path)
    with pytest.raises(UnknownTenant):
        directory.database_for("t_1")
    assert directory.database_for("t_3") == "gamma_db"
    assert directory.databases() == ["gamma_db"]
    assert len(reads) == 3


def test_registry_cached_snapshot_still_honours_the_barrier_and_a_missing_file(tmp_path):
    path = tmp_path / "registry.json"
    directory = RegistryDirectory(write_registry(path, [TENANT]))
    assert directory.database_for("t_1") == "acme_db"
    barrier = tmp_path / "registry.json.pending"
    barrier.write_text("", encoding="utf-8")
    with pytest.raises(UnknownTenant):
        directory.database_for("t_1")
    barrier.unlink()
    assert directory.database_for("t_1") == "acme_db"
    path.unlink()
    with pytest.raises(UnknownTenant):  # a removed registry never serves the last snapshot
        directory.database_for("t_1")
    assert directory.databases() == []


def test_registry_never_binds_a_file_rewritten_during_its_read(tmp_path, monkeypatch):
    path = tmp_path / "registry.json"
    directory = RegistryDirectory(write_registry(path, [TENANT]))
    original = Path.read_text

    def rewritten_meanwhile(self, *args, **kwargs):
        text = original(self, *args, **kwargs)
        write_registry(path, [], snapshot_revision=2)
        return text

    monkeypatch.setattr(Path, "read_text", rewritten_meanwhile)
    with pytest.raises(UnknownTenant):
        directory.database_for("t_1")
    monkeypatch.undo()
    assert directory.databases() == []  # the rewritten publication, read afresh


def test_registry_cache_hit_denies_a_publication_finished_during_the_call(tmp_path, monkeypatch):
    from liwan_ai_service import tenancy

    path = tmp_path / "registry.json"
    directory = RegistryDirectory(write_registry(path, [TENANT]))
    assert directory.database_for("t_1") == "acme_db"
    checks = []
    original = tenancy._publication_pending

    def publish_between_checks(barrier):
        checks.append(barrier)
        if len(checks) == 2:  # barrier created, t_1 disabled by an atomic rename, barrier removed: all after the stat
            replacement = tmp_path / "next.json"
            write_registry(replacement, [{**TENANT, "enabled": False}], snapshot_revision=2)
            os.replace(replacement, path)
        return original(barrier)

    monkeypatch.setattr(tenancy, "_publication_pending", publish_between_checks)
    with pytest.raises(UnknownTenant):
        directory.database_for("t_1")

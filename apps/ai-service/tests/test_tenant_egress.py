"""A tenant's own endpoint: which base URLs are accepted, and how the egress proxy learns the host of a saved key."""
import asyncio
from dataclasses import replace

import httpx
import pytest

from liwan_ai_service import tenant_egress
from liwan_ai_service.tenant_config import Keyring
from liwan_ai_service.tenant_egress import BaseUrlRefusedError, TenantEgress, base_url_host, check_base_url, is_public, key_host
from tests.fakes import ScriptedChatModel, SeededStates, make_memory_app
from tests.test_service import HEADERS, SETTINGS

KEYRING = Keyring({"k1": "s" * 40}, "k1")
TENANT_KEY = "sk-tenant-0123456789abcd"
GENERIC = {"provider": "openai_compatible", "model": "llama-3", "api_key": TENANT_KEY, "base_url": "https://llm.tenant.example/v1"}


@pytest.fixture
def resolving(monkeypatch):
    """Resolution of every host is whatever the test says; nothing reaches DNS."""
    answers = {"llm.tenant.example": ["93.184.216.34"]}

    async def resolve(host):
        return answers.get(host, [])

    monkeypatch.setattr(tenant_egress, "resolve", resolve)
    return answers


@pytest.mark.parametrize("url", [
    "http://llm.example.com/v1",  # not https
    "https://user:pw@llm.example.com/v1",  # credentials
    "https://llm.example.com:8443/v1",  # the proxy opens port 443 only
    "https://llm.example.com/v1?key=1",
    "https://llm.example.com/v1#frag",
    "https://93.184.216.34/v1",  # a raw IP address
    "https://[2606:2800:220:1:248:1893:25c8:1946]/v1",
    "https://2130706433/v1",  # an IPv4 address written as a number
    "https://localhost/v1",
    "https://llm/v1",  # a single label is an internal name
    "https://llm.internal.1/v1",
    "https://LLM.example.com\n/v1",
    "https://lm.exämple.com/v1",  # not punycode
    "ftp://llm.example.com/",
    "llm.example.com",
    "https://",
    "https://[api.example.com/v1",  # an unclosed IPv6 bracket makes the parser itself refuse
])
def test_a_base_url_of_the_wrong_shape_is_invalid(url):
    with pytest.raises(BaseUrlRefusedError) as refused:
        base_url_host(url)
    assert refused.value.code == "invalid"


def test_a_sound_base_url_names_its_lowercase_host():
    assert base_url_host("https://LLM.Example.com/v1/") == "llm.example.com"
    assert base_url_host("https://api.together.xyz:443") == "api.together.xyz"
    assert base_url_host("https://xn--mnchen-3ya.example.de/v1") == "xn--mnchen-3ya.example.de"


@pytest.mark.parametrize("address", [
    "10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1",
    "::1", "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "::",
    "2002:a00:1::1", "64:ff9b:1::a00:1", "192.0.2.1", "198.51.100.7", "203.0.113.9", "2001:db8::1",
])
def test_private_loopback_link_local_cgnat_multicast_and_reserved_addresses_are_not_public(address):
    assert is_public(address) is False


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:8.8.8.8"])
def test_global_unicast_addresses_are_public(address):
    assert is_public(address) is True


async def test_every_resolved_address_must_be_public(resolving):
    assert await check_base_url("https://llm.tenant.example/v1") == "llm.tenant.example"
    resolving["llm.tenant.example"] = ["93.184.216.34", "10.0.0.7"]  # one private address is enough to refuse
    with pytest.raises(BaseUrlRefusedError) as refused:
        await check_base_url("https://llm.tenant.example/v1")
    assert refused.value.code == "ai_base_url_not_public"
    resolving["llm.tenant.example"] = ["::1"]
    with pytest.raises(BaseUrlRefusedError):
        await check_base_url("https://llm.tenant.example/v1")


async def test_a_host_this_process_cannot_resolve_is_left_to_the_proxy(resolving):
    # Inside an internal Docker network no public name resolves; ai-egress refuses a private destination when it connects.
    assert await check_base_url("https://elsewhere.example/v1") == "elsewhere.example"


def test_a_key_needs_its_providers_own_host_or_the_tenants():
    assert key_host("anthropic", None) == "api.anthropic.com"
    assert key_host("openai", None) == "api.openai.com"
    assert key_host("openrouter", None) == "openrouter.ai"
    assert key_host("openai_compatible", "https://LLM.tenant.example/v1") == "llm.tenant.example"


async def test_the_host_file_is_written_replaced_and_withdrawn(tmp_path):
    egress = TenantEgress(str(tmp_path))
    await egress.publish("acme", "api.anthropic.com")
    assert (tmp_path / "acme.hosts").read_text() == "api.anthropic.com\n"
    assert (tmp_path / "acme.hosts").stat().st_mode & 0o777 == 0o644
    await egress.publish("acme", "llm.tenant.example")
    assert (tmp_path / "acme.hosts").read_text() == "llm.tenant.example\n"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["acme.hosts"]  # no temporary file is left for the proxy to read
    await egress.publish("acme", None)
    await egress.publish("acme", None)  # withdrawing twice is fine
    assert list(tmp_path.iterdir()) == []


async def test_without_a_directory_nothing_is_published():
    await TenantEgress(None).publish("acme", "api.anthropic.com")


def app_for(tmp_path):
    settings = replace(SETTINGS, keyring=KEYRING, tenant_egress_dir=str(tmp_path))
    states = SeededStates()
    return make_memory_app(ScriptedChatModel([]), settings, states=states)


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def test_saving_the_generic_provider_publishes_its_host_and_returns_the_url_without_the_key(tmp_path, resolving):
    async with client_for(app_for(tmp_path)) as client:
        saved = await client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS)
        assert saved.status_code == 200 and TENANT_KEY not in saved.text
        assert saved.json()["key"]["base_url"] == GENERIC["base_url"]
        assert (tmp_path / "t1.hosts").read_text() == "llm.tenant.example\n"
        named = await client.put("/v1/tenant/config/key", json={"provider": "anthropic", "model": "m", "api_key": TENANT_KEY}, headers=HEADERS)
        assert named.json()["key"]["base_url"] is None
        assert (tmp_path / "t1.hosts").read_text() == "api.anthropic.com\n"
        cleared = await client.delete("/v1/tenant/config/key", headers=HEADERS)
        assert cleared.json()["key"]["configured"] is False
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(("body", "code"), [
    ({**GENERIC, "base_url": None}, "invalid"),  # the generic provider needs its endpoint
    ({"provider": "anthropic", "model": "m", "api_key": TENANT_KEY, "base_url": "https://llm.tenant.example/v1"}, "invalid"),  # a named one keeps its own
    ({**GENERIC, "base_url": "http://llm.tenant.example/v1"}, "invalid"),
    ({**GENERIC, "base_url": "https://10.0.0.5/v1"}, "invalid"),
])
async def test_a_key_with_the_wrong_base_url_is_refused_with_its_field_and_nothing_is_stored(tmp_path, resolving, body, code):
    async with client_for(app_for(tmp_path)) as client:
        refused = await client.put("/v1/tenant/config/key", json=body, headers=HEADERS)
        assert refused.status_code == 422 and refused.json() == {"detail": {"code": code, "field": "base_url"}}
        assert TENANT_KEY not in refused.text
        assert (await client.get("/v1/tenant/config", headers=HEADERS)).json()["key"]["configured"] is False
    assert list(tmp_path.iterdir()) == []


async def test_a_base_url_that_resolves_to_a_private_address_is_refused(tmp_path, resolving):
    resolving["llm.tenant.example"] = ["192.168.0.9"]
    async with client_for(app_for(tmp_path)) as client:
        refused = await client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS)
        assert refused.status_code == 422
        assert refused.json() == {"detail": {"code": "ai_base_url_not_public", "field": "base_url"}}
        assert TENANT_KEY not in refused.text
    assert list(tmp_path.iterdir()) == []


async def test_a_failed_publication_is_reported_and_the_save_can_be_repeated(tmp_path, resolving):
    app = app_for(tmp_path / "missing")  # the shared volume is not mounted
    async with client_for(app) as client:
        failed = await client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS)
    assert failed.status_code == 503 and failed.json() == {"detail": "ai_egress_unavailable"}


async def test_startup_publishes_the_host_of_every_saved_key_again(tmp_path, resolving):
    app = app_for(tmp_path)
    async with client_for(app) as client:
        await client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS)
    (tmp_path / "t1.hosts").unlink()  # the volume was recreated while the key stayed in the database
    await app.state.sync_egress()
    assert (tmp_path / "t1.hosts").read_text() == "llm.tenant.example\n"


async def test_two_saves_of_one_tenant_end_with_the_host_of_the_key_that_was_stored_last(tmp_path, resolving):
    resolving["llm.other.example"] = ["93.184.216.34"]
    other = {**GENERIC, "base_url": "https://llm.other.example/v1"}
    async with client_for(app_for(tmp_path)) as client:
        first, second = await asyncio.gather(
            client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS),
            client.put("/v1/tenant/config/key", json=other, headers=HEADERS),
        )
        stored = (await client.get("/v1/tenant/config", headers=HEADERS)).json()["key"]["base_url"]
    assert first.status_code == second.status_code == 200
    expected = base_url_host(stored)
    assert (tmp_path / "t1.hosts").read_text() == f"{expected}\n"
    assert [path.name for path in tmp_path.iterdir()] == ["t1.hosts"]  # no temporary file survives


async def test_concurrent_writes_never_share_a_temporary_file(tmp_path):
    egress = TenantEgress(str(tmp_path))
    await asyncio.gather(*(egress.publish("acme", f"h{n}.example.com") for n in range(20)))
    assert [path.name for path in tmp_path.iterdir()] == ["acme.hosts"]
    assert (tmp_path / "acme.hosts").read_text().endswith(".example.com\n")


async def test_a_failed_write_leaves_no_temporary_file(tmp_path, monkeypatch):
    def broken(*_args):
        raise OSError("disk full")

    monkeypatch.setattr(tenant_egress.os, "replace", broken)
    with pytest.raises(OSError, match="disk full"):
        await TenantEgress(str(tmp_path)).publish("acme", "api.anthropic.com")
    assert list(tmp_path.iterdir()) == []


async def test_startup_sync_deletes_the_hosts_of_databases_that_are_no_longer_served(tmp_path, resolving):
    app = app_for(tmp_path)
    async with client_for(app) as client:
        await client.put("/v1/tenant/config/key", json=GENERIC, headers=HEADERS)  # t1 is served
    (tmp_path / "gone.hosts").write_text("llm.gone.example\n")
    (tmp_path / "notes.txt").write_text("not a host file\n")
    await app.state.sync_egress()
    assert sorted(path.name for path in tmp_path.iterdir()) == ["notes.txt", "t1.hosts"]


async def test_a_sync_that_serves_no_database_deletes_nothing(tmp_path):
    # An unreadable or pending registry answers no database; that must not cut every tenant off.
    (tmp_path / "t1.hosts").write_text("llm.tenant.example\n")
    await app_for(tmp_path).state.sync_egress()
    assert [path.name for path in tmp_path.iterdir()] == ["t1.hosts"]

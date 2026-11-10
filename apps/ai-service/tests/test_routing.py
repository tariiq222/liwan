"""``RunModels``: which model serves which capability, and what its calls report."""
from dataclasses import replace

from liwan_ai_service.routing import RunModels
from liwan_ai_service.usage import ModelIdentity, RunModel
from tests.fakes import ScriptedChatModel


def run_model(name: str, capability="standard") -> RunModel:
    return RunModel(ScriptedChatModel([]), ModelIdentity("ollama", name, "platform", capability))


def test_an_unmapped_capability_falls_to_the_default_and_reports_the_capability_served():
    default = run_model("base")
    models = RunModels(default)
    for capability in ("quick", "standard", "analysis", "writing"):
        served = models.for_capability(capability)
        assert served.model is default.model
        assert (served.identity.model, served.identity.capability) == ("base", capability)
    assert default.identity.capability == "standard"  # the default itself is not touched


def test_a_mapped_capability_gets_its_own_model():
    default, deep = run_model("base"), run_model("deep", "analysis")
    models = RunModels(default, {"analysis": deep})
    assert models.for_capability("analysis") is deep
    assert models.for_capability("writing").model is default.model


def test_a_pinned_model_serves_every_capability_under_its_own_identity():
    quick = run_model("fast", "quick")
    models = RunModels.pinned(replace(quick, identity=replace(quick.identity, billing="setup")))
    for capability in ("quick", "standard", "analysis", "writing"):
        served = models.for_capability(capability)
        assert (served.identity.model, served.identity.capability, served.identity.billing) == ("fast", "quick", "setup")


def test_only_a_map_with_two_distinct_models_can_route():
    base, deep = run_model("base"), run_model("deep", "analysis")
    assert not RunModels(base).can_route
    assert RunModels(base, {"analysis": deep}).can_route
    assert not RunModels(base, {"analysis": RunModel(base.model, deep.identity)}).can_route  # the same model object under another identity
    assert not RunModels.pinned(base).can_route
    assert not RunModels(base, dict.fromkeys(("quick", "standard", "analysis", "writing"), deep)).can_route  # the default is unreachable


def test_the_default_can_serve_under_any_capability_even_one_that_is_mapped():
    base = run_model("base")
    models = RunModels(base, {"analysis": run_model("deep", "analysis")})
    served = models.default_as("analysis")
    assert served.model is base.model
    assert (served.identity.model, served.identity.capability) == ("base", "analysis")

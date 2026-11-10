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

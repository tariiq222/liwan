"""The models one request can run on, by the kind of task: a default and an optional model per capability."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import get_args

from liwan_ai_service.contracts import Capability
from liwan_ai_service.usage import RunModel


@dataclass(frozen=True)
class RunModels:
    """``default`` serves every capability without an entry in ``by_capability``.

    An entry is used as it is: its identity names the capability it serves.
    """

    default: RunModel
    by_capability: Mapping[str, RunModel] = field(default_factory=dict)

    @classmethod
    def pinned(cls, run_model: RunModel) -> RunModels:
        """Every capability resolves to ``run_model`` and reports the capability its identity already names."""
        return cls(run_model, dict.fromkeys(get_args(Capability), run_model))

    def for_capability(self, capability: str) -> RunModel:
        mapped = self.by_capability.get(capability)
        if mapped is not None:
            return mapped
        return replace(self.default, identity=replace(self.default.identity, capability=capability))

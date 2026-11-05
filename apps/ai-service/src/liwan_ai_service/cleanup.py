"""Delete runs (and their checkpoints) older than AI_RUN_RETENTION_DAYS. Scheduled by the deployment."""
from __future__ import annotations

import asyncio
import os
import sys

from liwan_ai_service.settings import CleanupSettings
from liwan_ai_service.tenancy import directory_from_env
from liwan_ai_service.tenant_state import TenantStates


def open_tenant_states(database_url: str | None) -> TenantStates:
    """Every served tenant's state; retention deletes rows only, so no graph is built."""
    return TenantStates(directory_from_env(os.environ), database_url, lambda _checkpointer: None)


async def run() -> str:
    settings = CleanupSettings.from_env(os.environ)
    states = open_tenant_states(settings.database_url)
    deleted = 0
    try:
        async for state in states.each():
            deleted += len(await state.store.delete_older_than(settings.retention_days))
    finally:
        await states.aclose()
    return f"deleted {deleted} runs older than {settings.retention_days} days"


async def main() -> int:
    try:
        report = await run()
    except Exception as error:  # noqa: BLE001 - the job reports why it failed by class only; the text may carry the connection string
        print(f"cleanup failed: {type(error).__name__}", file=sys.stderr)
        return 1
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

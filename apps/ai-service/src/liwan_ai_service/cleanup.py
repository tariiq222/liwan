"""Delete runs (and their checkpoints) older than each tenant's own retention window, and the conversations of leavers
past theirs. Scheduled by the deployment.

The window is the tenant's ``ai_tenant_config.retention_days``, set from the AI settings page; a smaller value
deletes the older runs at the next sweep, never inside the request that changed it.
"""
from __future__ import annotations

import asyncio
import contextlib
import os
import sys

from liwan_ai_service.settings import CleanupSettings
from liwan_ai_service.tenancy import directory_from_env
from liwan_ai_service.tenant_state import TenantState, TenantStates


def open_tenant_states(database_url: str | None) -> TenantStates:
    """Every served tenant's state; retention deletes rows only, so no graph is built."""
    return TenantStates(directory_from_env(os.environ), database_url, lambda _checkpointer: None)


async def sweep_leavers(state: TenantState, leaver_retention_days: int) -> int:
    """Apply the offboarding events Odoo reported, then delete the conversations of leavers past their retention."""
    await state.memory.drain_outbox()
    deleted = 0
    for user_ref in await state.memory.expired_leavers(leaver_retention_days):
        deleted += len(await state.store.delete_runs_of(user_ref))
        await state.memory.forget_all(user_ref)
        await state.memory.mark_swept(user_ref)  # the leaver stays marked, so no later save can recreate their memory
    return deleted


async def run() -> tuple[str, list[str]]:
    """Clean every tenant database; one tenant's failure is a line of its own and never stops the others."""
    settings = CleanupSettings.from_env(os.environ)
    states = open_tenant_states(settings.database_url)
    deleted = 0
    cleaned_tenants = 0
    failures: list[str] = []
    try:
        def unavailable(database: str, error: Exception) -> None:
            failures.append(f"{database}: {type(error).__name__}")

        if not states.directory.databases():
            # A real deployment always serves a tenant: an empty directory is a missing or pending registry,
            # and a job that cleaned nothing must not report success.
            failures.append("directory: no tenant database served")
        async with contextlib.aclosing(states.each(on_unavailable=unavailable)) as sweep:
            async for state in sweep:
                try:
                    config = await state.config.get()
                    deleted += len(await state.store.delete_older_than(config.retention_days))
                    deleted += await sweep_leavers(state, config.leaver_retention_days)
                except Exception as error:  # noqa: BLE001 - one tenant must not stop the others; the text may carry its connection string
                    failures.append(f"{state.database}: {type(error).__name__}")
                else:
                    cleaned_tenants += 1
    finally:
        await states.aclose()
    return f"deleted {deleted} runs past their retention in {cleaned_tenants} tenants", failures


async def main() -> int:
    try:
        report, failures = await run()
    except Exception as error:  # noqa: BLE001 - the job reports why it failed by class only; the text may carry the connection string
        print(f"cleanup failed: {type(error).__name__}", file=sys.stderr)
        return 1
    print(report)
    for line in failures:
        print(f"cleanup failed for {line}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

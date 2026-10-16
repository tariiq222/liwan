"""Delete runs (and their checkpoints) older than AI_RUN_RETENTION_DAYS. Scheduled by the deployment."""
from __future__ import annotations

import asyncio
import os
import sys

from webvue_ai_service.settings import CleanupSettings
from webvue_ai_service.store import open_state


async def run() -> str:
    settings = CleanupSettings.from_env(os.environ)
    store, _checkpointer, aclose = await open_state(settings.database_url)
    try:
        gone = await store.delete_older_than(settings.retention_days)
    finally:
        await aclose()
    return f"deleted {len(gone)} runs older than {settings.retention_days} days"


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

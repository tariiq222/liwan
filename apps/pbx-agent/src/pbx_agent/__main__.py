"""Entry point: validate the environment, then serve. A bad configuration exits before any socket opens."""

from __future__ import annotations

import logging
import os
import sys

import uvicorn

from pbx_agent.app import create_app
from pbx_agent.settings import Settings, SettingsError

log = logging.getLogger("pbx_agent")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        settings = Settings.from_env(os.environ)
    except SettingsError as exc:
        # The message names the variable and never its value, so this is safe to show in the container log.
        log.error("%s", exc)
        return 2
    uvicorn.run(
        create_app(settings),
        host=settings.listen_host,
        port=settings.listen_port,
        access_log=False,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

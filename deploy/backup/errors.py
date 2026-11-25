# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The refusal types of the backup package, and the one assertion helper.

A failed check raises :class:`BackupError`; nothing that claims success is uploaded,
written or recorded after it. A retired tenant is not a failure but an outcome, so it
has its own type and raises no alert.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from deploy.backup.capture import PurgeReport


class BackupError(Exception):
    """A check refused the run or a step failed; no success evidence was written."""


class TenantRetiredError(Exception):
    """The registry marks the tenant retired: its workspace is being or has been deleted.

    This is an outcome, not a failure. A retired tenant has nothing left worth backing up
    and its artifacts are purged, so neither a capture nor the freshness check may raise
    an alert.
    """


class PurgeIncompleteError(BackupError):
    """The prefix still held objects after the second pass; the tenant's backups are not gone."""

    def __init__(self, report: PurgeReport) -> None:
        super().__init__(f'purge incomplete: {report.remaining} object(s) remain under the tenant prefix')
        self.report = report


def require(condition: bool, message: str) -> None:
    """Refuse the run with ``message`` unless ``condition`` holds."""
    if not condition:
        raise BackupError(message)

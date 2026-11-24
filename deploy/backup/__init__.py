# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One backup implementation: capture, encrypt, store, retain, fetch, restore, verify.

The package is the only place this repository copies, encrypts, stores, keeps, fetches,
restores or verifies a backup. Its public surface is what a caller outside the package
uses; everything else — the ``pg_dump`` argv, the per-database lock, the snapshot layout,
the key layout, the manifest format, the intent file — is internal to it.

* :func:`capture` copies a source, encrypts it and uploads one artifact, manifest last.
* :func:`status` reports the recovery picture from a drill record.
* :func:`latest_artifact` and :func:`fetch_artifact` get a verified artifact back.
* :func:`restore_verified` restores one artifact into a scratch database and proves it.
* :class:`ServiceControl`, :func:`quiesce` and :func:`reconcile` are the restart safety
  around a service stop.
"""
from __future__ import annotations

from deploy.backup.capture import capture, status
from deploy.backup.quiet import ServiceControl, quiesce, reconcile
from deploy.backup.recover import fetch_artifact, latest_artifact
from deploy.backup.verify import restore_verified

__all__ = [
    'ServiceControl',
    'capture',
    'fetch_artifact',
    'latest_artifact',
    'quiesce',
    'reconcile',
    'restore_verified',
    'status',
]

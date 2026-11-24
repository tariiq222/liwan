# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the restart safety around a service stop promises, proven without a service.

Every rule here fails a test when it is removed: the intent is written *before* the stop,
a crash between the stop and the start leaves the state a reconcile acts on, and a
reconcile starts the service for every state that may have left it stopped, while an
absent or already resolved intent is left alone. A host capture stops nothing and says so.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from deploy.backup.errors import BackupError
from deploy.backup.quiet import (
    QUIESCE_FIELD,
    QUIESCE_NOT_REQUIRED,
    QUIESCE_STOPPED,
    STATE_CAPTURED,
    STATE_DONE,
    STATE_FAILED,
    STATE_QUIESCING,
    STATE_RESERVED,
    STATE_RESUMED,
    STOPPED_STATES,
    Intent,
    quiesce,
    quiesce_outcome,
    read_state,
    reconcile,
    record_state,
)

TENANT = 'acme'


class FakeService:
    """A service control that records the order of the calls it received."""

    def __init__(self, *, fail_start: bool = False) -> None:
        self.calls: list[str] = []
        self._fail_start = fail_start

    def stop(self) -> None:
        self.calls.append('stop')

    def start(self) -> None:
        self.calls.append('start')
        if self._fail_start:
            message = 'the service could not start'
            raise RuntimeError(message)


class QuietCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-quiet-')).resolve()
        self.intent = Intent(path=self.root / 'state' / 'intent.json', tenant=TENANT, kind='hourly')
        self.service = FakeService()

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            if path.is_symlink() or not path.is_dir():
                path.unlink()
            else:
                path.rmdir()
        self.root.rmdir()


class TestQuiesce(QuietCase):
    def test_the_intent_is_written_before_the_service_stops(self):
        states_at_stop = []

        class ObservingService(FakeService):
            def stop(inner) -> None:
                states_at_stop.append(read_state(self.intent))
                super().stop()

        outcome = quiesce(self.intent, ObservingService())
        self.assertEqual(states_at_stop, [STATE_QUIESCING])
        self.assertEqual(outcome, {QUIESCE_FIELD: QUIESCE_STOPPED})

    def test_a_host_capture_stops_nothing_and_records_not_required(self):
        self.assertEqual(quiesce(None, None), {QUIESCE_FIELD: QUIESCE_NOT_REQUIRED})
        self.assertEqual(quiesce_outcome(None), QUIESCE_NOT_REQUIRED)
        self.assertEqual(quiesce_outcome({}), QUIESCE_NOT_REQUIRED)
        self.assertFalse(self.intent.path.exists())

    def test_stopping_a_service_without_an_intent_is_refused_and_stops_nothing(self):
        with self.assertRaisesRegex(BackupError, 'needs an intent file'):
            quiesce(None, self.service)
        self.assertEqual(self.service.calls, [])

    def test_a_stop_that_raises_leaves_the_intent_for_the_reconcile(self):
        class FailingService(FakeService):
            def stop(inner) -> None:
                super().stop()
                message = 'the stop did not finish'
                raise RuntimeError(message)

        with self.assertRaises(RuntimeError):
            quiesce(self.intent, FailingService())
        self.assertEqual(read_state(self.intent), STATE_QUIESCING)


class TestReconcile(QuietCase):
    def test_every_state_that_may_have_left_the_service_stopped_starts_it(self):
        self.assertEqual(STOPPED_STATES, frozenset({STATE_QUIESCING, STATE_CAPTURED, STATE_FAILED}))
        for state in sorted(STOPPED_STATES):
            with self.subTest(state=state):
                self.service = FakeService()
                record_state(self.intent, state)
                self.assertEqual(reconcile(self.intent, self.service), STATE_RESUMED)
                self.assertEqual(self.service.calls, ['start'])
                self.assertEqual(read_state(self.intent), STATE_RESUMED)

    def test_an_unreadable_intent_is_treated_as_a_stopped_service(self):
        self.intent.path.parent.mkdir(parents=True)
        self.intent.path.write_text('{not json', encoding='utf-8')
        self.assertEqual(reconcile(self.intent, self.service), STATE_RESUMED)
        self.assertEqual(self.service.calls, ['start'])
        self.assertEqual(read_state(self.intent), STATE_RESUMED)

    def test_an_intent_with_an_unknown_state_is_started_and_rewritten(self):
        self.intent.path.parent.mkdir(parents=True)
        self.intent.path.write_text(json.dumps({'state': 'resumed-but-corrupt'}), encoding='utf-8')
        self.assertEqual(reconcile(self.intent, self.service), STATE_RESUMED)
        self.assertEqual(self.service.calls, ['start'])

    def test_an_absent_intent_starts_nothing_and_writes_nothing(self):
        self.assertEqual(reconcile(self.intent, self.service), STATE_DONE)
        self.assertEqual(self.service.calls, [])
        self.assertFalse(self.intent.path.exists())

    def test_an_already_resolved_intent_starts_nothing(self):
        for state in (STATE_RESUMED, STATE_DONE):
            with self.subTest(state=state):
                self.service = FakeService()
                record_state(self.intent, state)
                self.assertEqual(reconcile(self.intent, self.service), state)
                self.assertEqual(self.service.calls, [])
                self.assertEqual(read_state(self.intent), state)

    def test_a_host_capture_needs_no_reconcile(self):
        self.assertEqual(reconcile(None, None), QUIESCE_NOT_REQUIRED)
        self.assertEqual(self.service.calls, [])

    def test_a_reconcile_is_idempotent_after_the_service_was_started(self):
        record_state(self.intent, STATE_QUIESCING)
        reconcile(self.intent, self.service)
        reconcile(self.intent, self.service)
        self.assertEqual(self.service.calls, ['start'])


class TestIntentFile(QuietCase):
    def test_a_state_is_written_atomically_and_leaves_no_temporary_file(self):
        for state in (STATE_RESERVED, STATE_DONE):
            record_state(self.intent, state)
            self.assertEqual(read_state(self.intent), state)
        self.assertEqual(list(self.intent.path.parent.glob('.*.tmp')), [])

    def test_an_unknown_state_and_a_relative_path_are_refused(self):
        with self.assertRaises(BackupError):
            record_state(self.intent, 'half-stopped')
        with self.assertRaises(BackupError):
            record_state(Intent(path=Path('intent.json'), tenant=TENANT, kind='hourly'), STATE_DONE)
        self.assertFalse(self.intent.path.exists())

    def test_a_missing_file_reads_as_no_state(self):
        self.assertIsNone(read_state(self.intent))

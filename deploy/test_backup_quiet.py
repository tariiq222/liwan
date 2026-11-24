# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the restart safety around a service stop promises, proven without a service.

Every rule here fails a test when it is removed: the intent is written *before* the stop, a
crash between the stop and the start leaves the state a reconcile acts on, and a reconcile
starts the service only for the attempt and tenant the intent names — an intent written by
another attempt is somebody else's work in flight, so nothing is started and it is not
rewritten. An absent, unreadable or already resolved intent starts nothing, and a host
capture stops nothing and writes no intent.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from deploy.backup.errors import BackupError
from deploy.backup.quiet import (
    STATE_CAPTURED,
    STATE_DONE,
    STATE_QUIESCING,
    STATE_RESUMED,
    Intent,
    quiesce,
    read_intent,
    reconcile,
    record_state,
)

TENANT = 'acme'
ATTEMPT = 'attempt-one'


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
        self.intent = Intent(path=self.root / 'state' / 'intent.json', tenant=TENANT, kind='odoo', attempt=ATTEMPT)
        self.service = FakeService()

    def tearDown(self) -> None:
        for path in sorted(self.root.rglob('*'), reverse=True):
            if path.is_symlink() or not path.is_dir():
                path.unlink()
            else:
                path.rmdir()
        self.root.rmdir()

    def state(self) -> str | None:
        recorded = read_intent(self.intent)
        return None if recorded is None else recorded['state']


class TestQuiesce(QuietCase):
    def test_the_intent_is_written_before_the_service_stops(self):
        states_at_stop = []

        class ObservingService(FakeService):
            def stop(inner) -> None:
                states_at_stop.append(self.state())
                super().stop()

        self.assertIsNone(quiesce(self.intent, ObservingService()))
        self.assertEqual(states_at_stop, [STATE_QUIESCING])

    def test_a_host_capture_stops_nothing_and_writes_no_intent(self):
        self.assertIsNone(quiesce(None, None))
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
        self.assertEqual(self.state(), STATE_QUIESCING)


class TestReconcile(QuietCase):
    def test_the_states_that_may_have_left_the_service_stopped_start_it_again(self):
        for state in (STATE_QUIESCING, STATE_CAPTURED):
            with self.subTest(state=state):
                self.service = FakeService()
                record_state(self.intent, state)
                self.assertEqual(reconcile(self.intent, self.service, attempt=ATTEMPT), STATE_RESUMED)
                self.assertEqual(self.service.calls, ['start'])
                self.assertEqual(self.state(), STATE_RESUMED)

    def test_an_intent_written_by_another_attempt_is_left_alone(self):
        # The shared state directory holds one intent for every tenant: a refused job must not start
        # the service another attempt stopped on purpose, mid-capture.
        for state in (STATE_QUIESCING, STATE_CAPTURED):
            with self.subTest(state=state):
                self.service = FakeService()
                record_state(self.intent, state)
                self.assertEqual(reconcile(self.intent, self.service, attempt='attempt-two'), STATE_DONE)
                self.assertEqual(self.service.calls, [])
                self.assertEqual(self.state(), state)

    def test_an_intent_of_another_tenant_is_left_alone(self):
        record_state(self.intent, STATE_QUIESCING)
        other = Intent(path=self.intent.path, tenant='other', kind='odoo', attempt=ATTEMPT)
        self.assertEqual(reconcile(other, self.service, attempt=ATTEMPT), STATE_DONE)
        self.assertEqual(self.service.calls, [])

    def test_no_attempt_is_never_attributed_and_starts_nothing(self):
        record_state(self.intent, STATE_QUIESCING)
        self.assertEqual(reconcile(self.intent, self.service, attempt=''), STATE_DONE)
        self.assertEqual(self.service.calls, [])

    def test_an_unreadable_intent_starts_nothing_and_is_not_rewritten(self):
        for text in ('{not json', json.dumps({'state': STATE_QUIESCING}), json.dumps({'state': 'unknown'})):
            with self.subTest(text=text):
                self.service = FakeService()
                self.intent.path.parent.mkdir(parents=True, exist_ok=True)
                self.intent.path.write_text(text, encoding='utf-8')
                self.assertEqual(reconcile(self.intent, self.service, attempt=ATTEMPT), STATE_DONE)
                self.assertEqual(self.service.calls, [])
                self.assertEqual(self.intent.path.read_text(encoding='utf-8'), text)

    def test_an_absent_intent_starts_nothing_and_writes_nothing(self):
        self.assertEqual(reconcile(self.intent, self.service, attempt=ATTEMPT), STATE_DONE)
        self.assertEqual(self.service.calls, [])
        self.assertFalse(self.intent.path.exists())

    def test_an_already_resolved_intent_starts_nothing(self):
        for state in (STATE_RESUMED, STATE_DONE):
            with self.subTest(state=state):
                self.service = FakeService()
                record_state(self.intent, state)
                self.assertEqual(reconcile(self.intent, self.service, attempt=ATTEMPT), state)
                self.assertEqual(self.service.calls, [])
                self.assertEqual(self.state(), state)

    def test_a_host_capture_needs_no_reconcile(self):
        self.assertEqual(reconcile(None, None, attempt=ATTEMPT), STATE_DONE)

    def test_a_reconcile_is_idempotent_after_the_service_was_started(self):
        record_state(self.intent, STATE_QUIESCING)
        reconcile(self.intent, self.service, attempt=ATTEMPT)
        reconcile(self.intent, self.service, attempt=ATTEMPT)
        self.assertEqual(self.service.calls, ['start'])

    def test_a_failed_start_leaves_the_state_for_the_next_reconcile(self):
        record_state(self.intent, STATE_CAPTURED)
        with self.assertRaises(RuntimeError):
            reconcile(self.intent, FakeService(fail_start=True), attempt=ATTEMPT)
        self.assertEqual(self.state(), STATE_CAPTURED)
        self.assertEqual(reconcile(self.intent, FakeService(), attempt=ATTEMPT), STATE_RESUMED)


class TestIntentFile(QuietCase):
    def test_a_state_is_written_atomically_and_leaves_no_temporary_file(self):
        for state in (STATE_QUIESCING, STATE_DONE):
            record_state(self.intent, state)
            self.assertEqual(self.state(), state)
        self.assertEqual(list(self.intent.path.parent.glob('.*.tmp')), [])

    def test_the_recorded_tenant_and_attempt_are_the_ones_that_wrote_it(self):
        record_state(self.intent, STATE_QUIESCING)
        self.assertEqual(read_intent(self.intent),
                         {'state': STATE_QUIESCING, 'tenant': TENANT, 'attempt': ATTEMPT})

    def test_an_unknown_state_and_a_relative_path_are_refused(self):
        with self.assertRaises(BackupError):
            record_state(self.intent, 'half-stopped')
        with self.assertRaises(BackupError):
            record_state(Intent(path=Path('intent.json'), tenant=TENANT, kind='odoo', attempt=ATTEMPT), STATE_DONE)
        self.assertFalse(self.intent.path.exists())

    def test_an_intent_without_an_attempt_is_refused(self):
        with self.assertRaises(BackupError):
            record_state(Intent(path=self.intent.path, tenant=TENANT, kind='odoo', attempt=''), STATE_DONE)
        self.assertFalse(self.intent.path.exists())

    def test_a_missing_file_reads_as_no_intent(self):
        self.assertIsNone(read_intent(self.intent))


if __name__ == '__main__':
    unittest.main()

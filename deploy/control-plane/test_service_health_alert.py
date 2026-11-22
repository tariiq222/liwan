#!/usr/bin/env python3
"""The host alert for the vendor console's services: one message per transition, nothing repeated.

The database reader and the alert sender are always fakes here, so no test opens a connection or a socket.
"""
import contextlib
import io
import json
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'deploy'))
import alerts  # noqa: E402
import service_health_alert as health  # noqa: E402

NOW = datetime(2026, 11, 22, 10, 0, tzinfo=timezone.utc)
SECRET_URL = 'https://admin:hunter2@db.internal/x'


class FakeReader:
    """What the table says now; a test changes `down` between runs. `error` makes the read fail."""

    def __init__(self, down=None, error=None):
        self.down = down or []
        self.error = error

    def __call__(self):
        if self.error:
            raise self.error
        return list(self.down)


class FakeAlerter:
    """Records the argv of every alert; `codes` is what each call returns, default 0 (delivered)."""

    def __init__(self, codes=None):
        self.calls = []
        self.codes = list(codes or [])

    def __call__(self, argv):
        self.calls.append(argv)
        return self.codes.pop(0) if self.codes else alerts.EXIT_OK


def row(component, state):
    return {'component': component, 'state': state}


class OneMessagePerTransition(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'state.json'
        self.reader = FakeReader()
        self.alerter = FakeAlerter()

    def run_once(self):
        return health.run(self.reader, self.alerter, health.StateFile(self.state))

    def test_a_service_turning_stale_is_announced_once_and_not_again_while_it_stays(self):
        self.reader.down = [row('shared_worker', 'stale')]
        self.assertEqual(self.run_once(), alerts.EXIT_OK)
        self.assertEqual(self.alerter.calls, [['service_down', '--component', 'shared_worker', '--state', 'stale']])
        for _ in range(3):
            self.assertEqual(self.run_once(), alerts.EXIT_OK)
        self.assertEqual(len(self.alerter.calls), 1)

    def test_a_recovery_is_announced_once_and_then_nothing(self):
        self.reader.down = [row('shared_worker', 'stale')]
        self.run_once()
        self.reader.down = []
        self.run_once()
        self.run_once()
        self.assertEqual(self.alerter.calls[1:], [['service_recovered', '--component', 'shared_worker']])
        self.assertEqual(len(self.alerter.calls), 2)

    def test_a_service_that_goes_down_again_is_a_new_transition(self):
        for down in ([row('mail_adapter', 'unavailable')], [], [row('mail_adapter', 'unavailable')]):
            self.reader.down = down
            self.run_once()
        self.assertEqual([call[0] for call in self.alerter.calls], ['service_down', 'service_recovered', 'service_down'])

    def test_a_change_of_how_a_service_is_down_is_announced(self):
        self.reader.down = [row('payment_adapter', 'unavailable')]
        self.run_once()
        self.reader.down = [row('payment_adapter', 'stale')]
        self.run_once()
        self.assertEqual(self.alerter.calls[1], ['service_down', '--component', 'payment_adapter', '--state', 'stale'])

    def test_each_component_is_its_own_transition_in_a_fixed_order(self):
        self.reader.down = [row('mail_adapter', 'unavailable'), row('shared_worker', 'stale')]
        self.run_once()
        self.reader.down = [row('shared_worker', 'stale')]
        self.run_once()
        self.assertEqual([call[:3] for call in self.alerter.calls],
                         [['service_down', '--component', 'mail_adapter'], ['service_down', '--component', 'shared_worker'],
                          ['service_recovered', '--component', 'mail_adapter']])

    def test_nothing_down_and_nothing_remembered_sends_nothing(self):
        self.assertEqual(self.run_once(), alerts.EXIT_OK)
        self.assertEqual(self.alerter.calls, [])
        self.assertFalse(self.state.exists())

    def test_a_remembered_transition_survives_the_next_process(self):
        self.reader.down = [row('shared_worker', 'stale')]
        self.run_once()
        later = FakeAlerter()
        self.assertEqual(health.run(self.reader, later, health.StateFile(self.state)), alerts.EXIT_OK)
        self.assertEqual(later.calls, [])
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)
        self.assertEqual(json.loads(self.state.read_text()), {'version': 1, 'down': {'shared_worker': 'stale'}})


class AMessageThatDidNotGoOutIsSentAgain(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = health.StateFile(Path(self.directory.name) / 'state.json')

    def test_a_refused_or_undelivered_alert_is_retried_on_the_next_run_and_fails_this_one(self):
        reader = FakeReader([row('shared_worker', 'stale')])
        for code in (alerts.EXIT_DELIVERY_FAILED, alerts.EXIT_REFUSED):
            alerter = FakeAlerter([code])
            self.assertEqual(health.run(reader, alerter, self.state), code)
        retry = FakeAlerter()
        self.assertEqual(health.run(reader, retry, self.state), alerts.EXIT_OK)
        self.assertEqual(len(retry.calls), 1)
        self.assertEqual(health.run(reader, retry, self.state), alerts.EXIT_OK)
        self.assertEqual(len(retry.calls), 1)

    def test_one_component_failing_to_send_does_not_stop_the_others(self):
        reader = FakeReader([row('mail_adapter', 'unavailable'), row('shared_worker', 'stale')])
        alerter = FakeAlerter([alerts.EXIT_DELIVERY_FAILED, alerts.EXIT_OK])
        self.assertEqual(health.run(reader, alerter, self.state), alerts.EXIT_DELIVERY_FAILED)
        self.assertEqual(len(alerter.calls), 2)
        self.assertEqual(self.state.load(), {'shared_worker': 'stale'})

    def test_an_unreadable_table_changes_nothing_and_sends_nothing(self):
        reader = FakeReader([row('shared_worker', 'stale')])
        health.run(reader, FakeAlerter(), self.state)
        broken = FakeReader(error=health.ReadError('the health table could not be read'))
        alerter = FakeAlerter()
        self.assertEqual(health.run(broken, alerter, self.state), alerts.EXIT_DELIVERY_FAILED)
        self.assertEqual((alerter.calls, self.state.load()), ([], {'shared_worker': 'stale'}))

    def test_a_row_that_is_not_a_known_state_or_a_code_is_refused_before_anything_is_sent(self):
        for bad in ([row('shared_worker', 'ok')], [row('Shared worker', 'stale')], [row(SECRET_URL, 'stale')],
                    [{'component': 'shared_worker'}], [row('shared_worker', 'stale'), row('shared_worker', 'stale')]):
            alerter = FakeAlerter()
            with self.subTest(bad=bad):
                self.assertEqual(health.run(FakeReader(bad), alerter, self.state), alerts.EXIT_REFUSED)
                self.assertEqual(alerter.calls, [])

    def test_a_damaged_state_file_is_refused_rather_than_guessed(self):
        self.state.path.write_text('{not json')
        alerter = FakeAlerter()
        self.assertEqual(health.run(FakeReader([row('shared_worker', 'stale')]), alerter, self.state), alerts.EXIT_REFUSED)
        self.assertEqual(alerter.calls, [])
        self.state.path.write_text(json.dumps({'version': 2, 'down': {}}))
        self.assertEqual(health.run(FakeReader(), alerter, self.state), alerts.EXIT_REFUSED)


class TheRealReaderAsksTheDatabaseDirectly(unittest.TestCase):
    ENV = {'LIWAN_CONTROL_HEALTH_DB_NAME': 'liwan_control', 'LIWAN_CONTROL_HEALTH_PG_HOST': '127.0.0.1',
           'LIWAN_CONTROL_HEALTH_PG_PORT': '15432', 'LIWAN_CONTROL_HEALTH_PG_USER': 'liwan_control_backup',
           'PGPASSFILE': '/etc/liwan/pgpass'}

    def test_it_runs_psql_against_the_one_function_that_holds_the_thresholds_with_no_password_in_argv(self):
        seen = {}

        def runner(argv, **kwargs):
            seen['argv'], seen['env'] = argv, kwargs['env']
            return subprocess.CompletedProcess(argv, 0, '[{"component":"shared_worker","state":"stale"}]\n', '')

        rows = health.psql_reader(self.ENV, runner=runner)()
        self.assertEqual(rows, [row('shared_worker', 'stale')])
        argv = seen['argv']
        self.assertEqual(argv[0], 'psql')
        for flag, value in (('--host', '127.0.0.1'), ('--port', '15432'), ('--username', 'liwan_control_backup'), ('--dbname', 'liwan_control')):
            self.assertEqual(argv[argv.index(flag) + 1], value)
        query = argv[argv.index('--command') + 1]
        self.assertIn('service_health_states(now())', query)
        self.assertNotRegex(query, r'\b(120|300|7200|minutes?|hours?)\b')
        self.assertEqual(seen['env']['PGPASSFILE'], '/etc/liwan/pgpass')
        self.assertFalse(any('pass' in part.lower() for part in argv if part != '--no-password'))

    def test_a_failed_psql_names_its_exit_and_leaks_nothing_it_printed(self):
        def runner(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 2, '', f'could not connect to {SECRET_URL}')

        with self.assertRaises(health.ReadError) as raised:
            health.psql_reader(self.ENV, runner=runner)()
        self.assertIn('exit 2', str(raised.exception))
        self.assertNotIn('hunter2', str(raised.exception))

    def test_psql_that_cannot_start_or_answers_text_is_a_read_error(self):
        def missing(argv, **kwargs):
            raise FileNotFoundError('psql')

        def garbage(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, 'not json', '')

        for runner in (missing, garbage):
            with self.subTest(runner=runner.__name__), self.assertRaises(health.ReadError):
                health.psql_reader(self.ENV, runner=runner)()

    def test_the_database_name_is_required(self):
        with self.assertRaises(health.ConfigError):
            health.psql_reader({}, runner=None)


class TheCommandLine(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = {'LIWAN_SERVICE_HEALTH_STATE_FILE': str(Path(self.directory.name) / 'state.json')}

    def main(self, env, reader, alerter):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            return health.main([], env=env, reader=reader, alerter=alerter), stderr.getvalue()

    def test_it_needs_a_state_file_and_says_so(self):
        code, message = self.main({}, FakeReader(), FakeAlerter())
        self.assertEqual(code, alerts.EXIT_REFUSED)
        self.assertIn('LIWAN_SERVICE_HEALTH_STATE_FILE', message)

    def test_the_state_directory_systemd_gives_a_service_is_the_default(self):
        env = {'STATE_DIRECTORY': self.directory.name}
        code, _ = self.main(env, FakeReader([row('shared_worker', 'stale')]), FakeAlerter())
        self.assertEqual(code, alerts.EXIT_OK)
        self.assertTrue((Path(self.directory.name) / 'service-health-alert.json').exists())

    def test_the_alerts_it_builds_are_accepted_by_alerts_py_and_reach_both_channels(self):
        email, telegram = [], []
        env = {**self.env, alerts.ENV_SMTP_HOST: 'smtp.example.test', alerts.ENV_SMTP_FROM: 'a@example.test',
               alerts.ENV_SMTP_TO: 'o@example.test', alerts.ENV_TELEGRAM_BOT_TOKEN: '1:tok', alerts.ENV_TELEGRAM_CHAT_ID: '4'}
        transports = alerts.Transports(email=email.append, telegram=telegram.append)
        alerter = health.alerts_main(env, transports=transports, now=NOW)
        with contextlib.redirect_stdout(io.StringIO()):
            code, _ = self.main(env, FakeReader([row('shared_worker', 'stale')]), alerter)
            self.assertEqual(code, alerts.EXIT_OK)
            code, _ = self.main(env, FakeReader(), alerter)
        self.assertEqual(code, alerts.EXIT_OK)
        self.assertEqual((len(email), len(telegram)), (2, 2))
        self.assertIn('service_down', telegram[0])
        self.assertIn('shared_worker', telegram[0])
        self.assertIn('service_recovered', telegram[1])

    def test_with_no_alert_channel_the_transition_is_not_remembered(self):
        alerter = health.alerts_main(self.env, now=NOW)
        with contextlib.redirect_stderr(io.StringIO()):
            code, _ = self.main(self.env, FakeReader([row('shared_worker', 'stale')]), alerter)
        self.assertEqual(code, alerts.EXIT_REFUSED)
        self.assertFalse(Path(self.env['LIWAN_SERVICE_HEALTH_STATE_FILE']).exists())


class TheUnits(unittest.TestCase):
    SERVICE = (HERE / 'liwan-service-health-alert.service').read_text()
    TIMER = (HERE / 'liwan-service-health-alert.timer').read_text()
    EXAMPLE = (HERE / 'service-health-alert.env.example').read_text()

    def test_the_service_runs_the_script_once_per_start_from_the_checkout(self):
        self.assertIn('Type=oneshot', self.SERVICE)
        self.assertIn('ExecStart=/usr/bin/python3 -B /opt/liwan/current/deploy/control-plane/service_health_alert.py', self.SERVICE)
        self.assertIn('EnvironmentFile=/etc/liwan/service-health-alert.env', self.SERVICE)
        self.assertIn('StateDirectory=liwan-service-health', self.SERVICE)
        settings = re.sub(r'(?m)^#.*$', '', self.SERVICE)
        for dependency in ('Requires=', 'After=', 'Wants=', 'liwan-shared-worker'):
            self.assertNotIn(dependency, settings)
        self.assertIn('NoNewPrivileges=true', self.SERVICE)
        self.assertTrue((HERE / 'service_health_alert.py').exists())

    def test_the_timer_fires_at_least_once_a_minute_and_starts_that_service(self):
        self.assertIn('OnCalendar=minutely', self.TIMER)
        self.assertIn('Unit=liwan-service-health-alert.service', self.TIMER)
        self.assertIn('WantedBy=timers.target', self.TIMER)

    def test_no_secret_value_is_written_in_a_unit_or_the_example(self):
        for text in (self.SERVICE, self.TIMER, self.EXAMPLE):
            self.assertNotRegex(text, r'(?m)^(?:Environment=)?[A-Z_]*(?:KEY|SECRET|PASSWORD|TOKEN)=[^\s<#]')

    def test_the_example_lists_every_variable_the_script_reads(self):
        source = (HERE / 'service_health_alert.py').read_text()
        for name in sorted(set(re.findall(r"'(LIWAN_[A-Z_]+|PGPASSFILE|STATE_DIRECTORY)'", source))):
            with self.subTest(name=name):
                self.assertIn(name, self.EXAMPLE)


if __name__ == '__main__':
    unittest.main()

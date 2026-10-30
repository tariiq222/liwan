# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bounded runner tests: Python children and mocked Docker observations only."""
import importlib.util
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

if importlib.util.find_spec('liwan_cli.managed_process') is None:
    process = None
else:
    from liwan_cli import managed_process as process


class BoundedProcessCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(process, 'managed_process missing (RED)')

    def python(self, script, **kwargs):
        return process.run([sys.executable, '-B', '-c', script], **kwargs)

    def test_success_strict_utf8_and_stdin(self):
        self.assertEqual(self.python('import sys; print(sys.stdin.read())', stdin_text='ليوان'), (0, 'ليوان\n', ''))

    def test_nonzero_stderr_and_invalid_encoding_reveal_no_output(self):
        for script in ["import sys; print('SECRET'); print('SECRET', file=sys.stderr); sys.exit(3)",
                       "import sys; sys.stdout.buffer.write(b'\\xff')"]:
            code, out, err = self.python(script)
            self.assertNotEqual(code, 0)
            self.assertEqual((out, err), ('', ''))

    def test_limit_exact_and_overflow_terminate_promptly(self):
        self.assertEqual(self.python("print('x'*16,end='')", output_limit=16), (0, 'x' * 16, ''))
        started = time.monotonic()
        self.assertEqual(self.python("import os\nwhile True: os.write(1,b'x'*8192)", output_limit=128, timeout=5), (125, '', ''))
        self.assertLess(time.monotonic() - started, 3)

    def test_timeout_kills_child_without_partial_output(self):
        started = time.monotonic()
        result = self.python("import os,time; os.write(1,b'SECRET'); time.sleep(30)", timeout=0.1)
        self.assertEqual(result, (124, '', ''))
        self.assertLess(time.monotonic() - started, 3)

    def test_timeout_kills_process_ignoring_termination(self):
        started = time.monotonic()
        self.assertEqual(self.python('import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)', timeout=0.1), (124, '', ''))
        self.assertLess(time.monotonic() - started, 3)

    def test_closed_stdout_still_has_execution_deadline(self):
        self.assertEqual(self.python('import os,time; os.close(1); time.sleep(30)', timeout=0.1), (124, '', ''))

    def test_bidirectional_pipes_do_not_deadlock(self):
        text = 'a' * 60000
        result = self.python("import sys; sys.stdout.write('b'*60000); sys.stdout.flush(); data=sys.stdin.read(); print(len(data))", stdin_text=text, output_limit=65536, timeout=3)
        self.assertEqual(result, (0, 'b' * 60000 + '60000\n', ''))

    def test_stdin_closed_early_does_not_leak_or_hang(self):
        result = self.python('import os; os.close(0); print("ok")', stdin_text='x' * 60000, timeout=2)
        self.assertIn(result[0], (0, 124))
        self.assertEqual(result[2], '')

    def test_unavailable_invalid_inputs_and_shell_tokens(self):
        self.assertEqual(process.run(['/no/such/fixture-program']), (124, '', ''))
        self.assertEqual(process.run([sys.executable], stdin_text='\ud800'), (124, '', ''))
        for argv, kwargs in [('echo unsafe', {}), ([], {}), ([sys.executable], {'timeout': 0}),
                             ([sys.executable], {'output_limit': -1}), ([sys.executable], {'stdin_text': 'x' * 65537})]:
            self.assertEqual(process.run(argv, **kwargs), (124, '', ''))
        self.assertEqual(process.run([sys.executable, '-c', 'import sys; print(sys.argv[1])', '$(echo unsafe);'], timeout=2), (0, '$(echo unsafe);\n', ''))

    def test_launch_is_no_shell_new_process_group_stderr_discarded(self):
        with patch.object(process.subprocess, 'Popen', side_effect=OSError('SECRET')) as popen:
            self.assertEqual(process.run(['fixture']), (124, '', ''))
        self.assertIs(popen.call_args.kwargs['shell'], False)
        self.assertIs(popen.call_args.kwargs['start_new_session'], True)
        self.assertEqual(popen.call_args.kwargs['stderr'], process.subprocess.DEVNULL)

    @unittest.skipUnless(hasattr(os, 'fork'), 'POSIX process groups required')
    def test_timeout_terminates_descendant_process_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / 'descendant.pid'
            script = ('import os,time,signal,sys\n'
                      'pid=os.fork()\n'
                      'if pid == 0:\n'
                      ' time.sleep(30)\n'
                      'else:\n'
                      ' def terminate(sig, frame):\n'
                      '  os.waitpid(pid,0)\n'
                      '  sys.exit(0)\n'
                      ' signal.signal(signal.SIGTERM, terminate)\n'
                      f' open({str(marker)!r},"w").write(str(pid))\n'
                      ' time.sleep(30)\n')
            self.assertEqual(self.python(script, timeout=0.3), (124, '', ''))
            pid = int(marker.read_text())
            # A killed grandchild may briefly be a zombie until init reaps it.
            # ps is deliberately NOT run: Python kill(pid,0) cannot distinguish it.
            with self.assertRaises(ProcessLookupError):
                os.killpg(pid, 0)  # descendant did not escape into its own group
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                pass
            else:
                proc_stat = Path(f'/proc/{pid}/stat')
                if proc_stat.exists():
                    self.assertEqual(proc_stat.read_text(encoding='utf-8').split()[2], 'Z')
                else:
                    self.skipTest('platform cannot distinguish killed zombie without process inspection')


class LocalDockerCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(process, 'managed_process missing (RED)')
        self.calls = []
        self.response = (0, json.dumps([{'Endpoints': {'docker': {'Host': 'unix:///fixture/docker.sock'}}}]), '')

    def runner(self, argv, env=None, stdin_text=None, **kwargs):
        self.calls.append((argv, env, stdin_text, kwargs))
        return self.response

    def factory(self):
        with patch.object(Path, 'resolve', lambda p, **kw: p), patch.object(Path, 'stat', return_value=SimpleNamespace(st_mode=stat.S_IFSOCK)):
            return process.local_docker_runner(env={'PATH': '/bin', 'HOME': '/fixture', 'DOCKER_HOST': 'tcp://remote', 'DOCKER_CONTEXT': 'remote', 'DOCKER_TLS_VERIFY': '1'}, runner=self.runner)

    def test_context_resolved_once_local_socket_pinned_and_env_sanitized(self):
        runner = self.factory()
        self.assertEqual(self.calls[0][0], ['docker', 'context', 'inspect'])
        self.assertFalse(any(key.startswith('DOCKER_') for key in self.calls[0][1]))
        self.response = (0, 'ok', '')
        self.assertEqual(runner(['docker', 'image', 'inspect', 'sha256:fixture'], env={'POSTGRES_PASSWORD': 'secret', 'DOCKER_HOST': 'ssh://bad'}), self.response)
        runner(['docker', 'volume', 'ls'])
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[1][0][:3], ['docker', '--host', 'unix:///fixture/docker.sock'])
        self.assertNotIn('DOCKER_HOST', self.calls[1][1])
        self.assertEqual(self.calls[1][1]['POSTGRES_PASSWORD'], 'secret')

    def test_remote_malformed_unknown_context_refused_no_fallback(self):
        for response in [(1, '', 'SECRET'), (0, '{}', ''), (0, 'not json', ''),
                         (0, '[{},{}]', ''), (0, json.dumps([{'Endpoints': {'docker': {'Host': 'tcp://remote:2375'}}}]), ''),
                         (0, json.dumps([{'Endpoints': {'docker': {'Host': 'ssh://remote'}}}]), ''),
                         (0, json.dumps([{'Endpoints': {'docker': {'Host': 'unix://relative'}}}]), ''),
                         (0, json.dumps([{'Endpoints': {'docker': {'Host': 'unix:///tmp/../other.sock'}}}]), '')]:
            self.response = response
            with self.assertRaises(process.ProcessError) as caught:
                self.factory()
            self.assertEqual(str(caught.exception), caught.exception.code)
            self.assertNotIn('SECRET', str(caught.exception))

    def test_duplicate_context_keys_and_runner_failure_are_sanitized(self):
        self.response = (0, '[{"Endpoints":{},"Endpoints":{}}]', '')
        with self.assertRaises(process.ProcessError):
            self.factory()
        with self.assertRaises(process.ProcessError):
            process.local_docker_runner(runner=lambda *args, **kwargs: (_ for _ in ()).throw(OSError('SECRET')))

    def test_pinned_runner_launch_failure_is_sanitized(self):
        runner = self.factory()
        runner.runner = lambda *args, **kwargs: (_ for _ in ()).throw(OSError('SECRET'))
        self.assertEqual(runner(['docker', 'ps']), (124, '', ''))

    def test_missing_or_non_socket_endpoint_refused(self):
        with patch.object(Path, 'resolve', side_effect=OSError('SECRET')):
            with self.assertRaises(process.ProcessError):
                process.local_docker_runner(runner=self.runner)
        with patch.object(Path, 'resolve', lambda p, **kw: p), patch.object(Path, 'stat', return_value=SimpleNamespace(st_mode=stat.S_IFREG)):
            with self.assertRaises(process.ProcessError):
                process.local_docker_runner(runner=self.runner)

    def test_docker_global_endpoint_overrides_refused(self):
        runner = self.factory()
        for argv in [['docker', '--host', 'tcp://bad', 'ps'], ['docker', '-Htcp://bad', 'ps'],
                     ['docker', '--context=bad', 'ps'], ['docker', '--config', '/bad', 'ps'],
                     ['docker', 'ps', '--context', 'remote'],
                     ['docker', 'ps', '--host=tcp://remote'],
                     ['docker', 'ps', '-H', 'tcp://remote'],
                     ['not-docker', 'anything']]:
            self.assertEqual(runner(argv), (124, '', ''))
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()

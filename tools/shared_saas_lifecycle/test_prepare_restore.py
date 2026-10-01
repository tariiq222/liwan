# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import multiprocessing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tools.shared_saas_lifecycle.prepare_restore import prepare_restore


def prepare_without_docker(state):
    with patch('tools.shared_saas_lifecycle.prepare_restore.prepare_networks'), contextlib.redirect_stdout(io.StringIO()):
        prepare_restore(state)


class RestorePreparationTests(unittest.TestCase):
    def state(self, path):
        env = path / 'compose.env'; env.write_text("EXISTING_SECRET='preserve-exactly'\n"); env.chmod(0o600)
        return {'stateDir': str(path), 'envFile': str(env), 'projectName': 'nasq-saas-life-test'}

    def test_resume_after_interruption_before_environment_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = self.state(Path(tmp))
            with patch('tools.shared_saas_lifecycle.prepare_restore.os.replace', side_effect=OSError('interrupted')):
                with self.assertRaises(OSError):
                    prepare_without_docker(state)
            prepare_without_docker(state)
            env = Path(state['envFile']).read_bytes(); config = (Path(tmp) / 'restore-odoo.conf').read_bytes()
            prepare_without_docker(state)
            self.assertEqual(Path(state['envFile']).read_bytes(), env)
            self.assertEqual((Path(tmp) / 'restore-odoo.conf').read_bytes(), config)
            self.assertIn(b"EXISTING_SECRET='preserve-exactly'", env)
            for path in Path(tmp).glob('*.restore-pending*'):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_concurrent_preparation_keeps_single_committed_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = self.state(Path(tmp))
            ctx = multiprocessing.get_context('fork')
            processes = [ctx.Process(target=prepare_without_docker, args=(state,)) for _ in range(4)]
            for process in processes: process.start()
            for process in processes:
                process.join(10); self.assertEqual(process.exitcode, 0)
            before = Path(state['envFile']).read_bytes()
            self.assertEqual(before.count(b'RESTORE_DB_PASSWORD='), 1)
            prepare_without_docker(state)
            self.assertEqual(Path(state['envFile']).read_bytes(), before)

if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Actual run-local caller ordering check with isolated fake dependencies."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('run-local.sh')
ROOT = SCRIPT.parents[2].resolve()


class RunLocalOrderingTests(unittest.TestCase):
    def test_new_database_waits_for_compose_health_before_identity_guard(self):
        source = SCRIPT.read_text(encoding='utf-8')
        create = source.index('up -d --wait')
        guard = source.index('resource_guard.py', create)
        self.assertLess(create, guard)

    def test_actual_caller_exports_derived_root_before_begin_generation(self):
        with tempfile.TemporaryDirectory(prefix='nasq-run-order-') as tmp:
            home = Path(tmp); state = home / 'processes'; state.mkdir(mode=0o700)
            for name in ('control-db-password', 'control-service-key', 'control-database-url', 'inventory-v2.json', 'runtime.env'):
                (home / name).write_text('{}' if name.endswith('.json') else 'fake')
            (state / 'generation').write_text('1234567890abcdef1234567890abcdef\n')
            bin_dir = home / 'fake-bin'; bin_dir.mkdir()
            node = bin_dir / 'node'; node.write_text('#!/bin/sh\necho v22.0.0\n'); node.chmod(0o700)
            npm = bin_dir / 'npm'; npm.write_text('#!/bin/sh\nexit 90\n'); npm.chmod(0o700)
            fake_path = bin_dir / 'python3'
            fake_path.write_text('''#!/bin/sh
case "$1" in
  */process_lock.py) exec "${REAL_PYTHON}" "$@" ;;
  */startup_handoff.py) exec "${REAL_PYTHON}" "$@" ;;
  */begin_generation.py)
    printf '%s\\n' "${NASQ_REPOSITORY_ROOT-unset}" > "$NASQ_CONTROL_HOME/observed-root"
    printf '%s\\n' "${NASQ_NODE_BIN-unset}" > "$NASQ_CONTROL_HOME/observed-node-bin"
    exit 91 ;;
  *) exit 92 ;;
esac
'''); fake_path.chmod(0o700)
            real_python = subprocess.check_output(['/usr/bin/which', 'python3'], text=True).strip()
            env = {**os.environ, 'NASQ_CONTROL_HOME': str(home), 'NASQ_NODE_BIN': str(bin_dir),
                   'PATH': f'{bin_dir}:{os.environ.get("PATH", "")}', 'REAL_PYTHON': real_python}
            # Run the real script via an absolute bash path; its first invocation
            # acquires the actual isolated lock and re-enters through startup_handoff.
            result = subprocess.run(['/bin/bash', str(SCRIPT), 'runtime'], env=env,
                                    capture_output=True, text=True, timeout=8)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotEqual(result.returncode, 91, result.stderr)
            self.assertEqual((home / 'observed-root').read_text().strip(), str(ROOT))
            self.assertEqual((home / 'observed-node-bin').read_text().strip(), str(bin_dir))
            self.assertEqual((state / 'generation').read_text(), '1234567890abcdef1234567890abcdef\n')
            self.assertEqual(list(home.glob('processes-archive-*')), [])


if __name__ == '__main__':
    unittest.main()

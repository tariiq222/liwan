"""Exercise the static profile selector against committed Git diffs."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('ci_static_profile.py')


class StaticProfileTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'CI profile test')
        self.git('config', 'user.email', 'ci@example.invalid')
        self.git('config', 'core.fileMode', 'true')
        self.write('docs/testing.md', b'original\n')
        self.write('apps/web/example.ts', b'export {}\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True)

    def write(self, path, contents):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(contents)
        return file

    def commit(self):
        self.git('add', '--all')
        self.git('commit', '-qm', 'change')

    def profile(self, base=None):
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--base', base or self.base],
                                cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_prose_additions_and_edits_use_docs_profile(self):
        self.write('docs/testing.md', b'updated\n')
        self.write('docs/guides/a file.md', b'# Guide\n')
        self.commit()
        self.assertEqual(self.profile(), 'docs')

    def test_root_instruction_documents_use_docs_profile(self):
        for path in ('AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'README.md', 'REVIEW.md'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.write(path, b'# Rules\n')
                self.write('docs/testing.md', b'updated\n')
                self.commit()
                self.assertEqual(self.profile(), 'docs')

    def test_nested_instruction_document_uses_full_profile(self):
        self.write('apps/web/AGENTS.md', b'# Web rules\n')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_mixed_change_including_application_code_uses_full_profile(self):
        self.write('docs/testing.md', b'updated\n')
        self.write('apps/web/example.ts', b'export const value = 1\n')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_unrecognized_and_machine_consumed_paths_use_full_profile(self):
        for path in ('unknown.md', 'package-lock.json', '.github/workflows/ci.yml',
                     'docs/data.json', 'docs/design-system/components.md', 'docs/api/README.md'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.write('docs/testing.md', b'updated\n')
                self.write(path, b'new\n')
                self.commit()
                self.assertEqual(self.profile(), 'full')

    def test_code_renamed_to_markdown_uses_full_profile(self):
        self.git('mv', 'apps/web/example.ts', 'docs/renamed.md')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_deletion_uses_full_profile(self):
        self.git('rm', 'docs/testing.md')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_symlink_executable_and_binary_are_not_prose(self):
        self.write('docs/testing.md', b'updated\n')
        for kind in ('symlink', 'executable', 'binary', 'late-binary', 'invalid-utf8'):
            with self.subTest(kind=kind):
                path = self.repo / 'docs/example.md'
                if kind == 'symlink':
                    path.symlink_to('testing.md')
                elif kind == 'executable':
                    self.write('docs/example.md', b'#!/bin/sh\n').chmod(0o755)
                elif kind == 'binary':
                    self.write('docs/example.md', b'abc\0xyz')
                elif kind == 'late-binary':
                    self.write('docs/example.md', b'a' * 9000 + b'\0xyz')
                else:
                    self.write('docs/example.md', b'not UTF-8: \xff\n')
                self.commit()
                self.assertEqual(self.profile(), 'full')
                self.git('checkout', '--quiet', '--detach', self.base)

    def test_empty_or_unreadable_diff_uses_full_profile(self):
        self.assertEqual(self.profile(), 'full')
        self.assertEqual(self.profile('no-such-ref'), 'full')

# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import forbidden_terms

MAP = {
    'domains': {'acme.sa': 'zeta.example'},
    'ordered_replacements': [['acme_', 'zeta_'], ['ACME_', 'ZETA_'], ['acme', 'zeta']],
}


def git(root, *args):
    subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)


class RenameBrandCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / 'repo'
        self.root.mkdir()
        self.map_path = Path(tmp.name) / 'map.json'
        self.map_path.write_text(json.dumps(MAP), encoding='utf-8')
        git(self.root, 'init', '-q')
        git(self.root, 'config', 'user.email', 'test@example.com')
        git(self.root, 'config', 'user.name', 'Test')

    def write(self, rel, data):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            path.write_bytes(data)
        else:
            path.write_text(data, encoding='utf-8')

    def commit(self):
        git(self.root, 'add', '-A')
        git(self.root, 'commit', '-q', '-m', 'seed')

    def read(self, rel):
        return (self.root / rel).read_text(encoding='utf-8')


class TestForbiddenTerms(RenameBrandCase):
    def scan(self, exceptions=None, allow=()):
        terms = self.root.parent / 'terms.txt'
        terms.write_text('# forbidden\nacme\n', encoding='utf-8')
        args = ['--terms', str(terms), '--root', str(self.root)]
        if exceptions is not None:
            path = self.root.parent / 'exceptions.txt'
            path.write_text(exceptions, encoding='utf-8')
            args += ['--exceptions', str(path)]
        for text in allow:
            args += ['--allow-string', text]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = forbidden_terms.main(args)
        return code, out.getvalue()

    def test_clean_tree_passes(self):
        self.write('a.txt', 'zeta\n')
        self.commit()
        self.assertEqual(self.scan()[0], 0)

    def test_hits_in_content_and_paths_fail_case_insensitively(self):
        self.write('a.txt', 'one\nAcme here\n')
        self.write('ACME_x/b.txt', 'clean\n')
        self.commit()
        code, out = self.scan()
        self.assertEqual(code, forbidden_terms.EXIT_FOUND)
        self.assertIn("a.txt:2: Acme", out)
        self.assertIn('ACME_x/b.txt: path contains', out)

    def test_exceptions_skip_files_by_glob_and_ignore_comments(self):
        self.write('docs/old.md', 'acme\n')
        self.write('b.txt', 'acme\n')
        self.commit()
        code, out = self.scan('# why\ndocs/* # historical record\n')
        self.assertEqual(code, forbidden_terms.EXIT_FOUND)
        self.assertNotIn('docs/old.md', out)
        self.assertIn('b.txt:1', out)

    def test_allowed_strings_are_ignored_but_other_hits_in_the_same_file_are_not(self):
        self.write('a.md', 'see org/acme and ~/code/acme here\nacme alone\n')
        self.write('org/acme/b.txt', 'clean\n')
        self.commit()
        code, out = self.scan(allow=['org/acme', '/code/acme'])
        self.assertEqual(code, forbidden_terms.EXIT_FOUND)
        self.assertIn('a.md:2: acme', out)
        self.assertNotIn('a.md:1', out)
        self.assertNotIn('org/acme/b.txt', out)
        self.assertEqual(self.scan(allow=['org/acme', '/code/acme', 'acme alone'])[0], 0)

    def test_removing_an_allowed_string_cannot_join_its_neighbours_into_a_hit(self):
        self.write('a.txt', 'ac/code/acmeme\n')
        self.commit()
        self.assertEqual(self.scan(allow=['/code/acme'])[0], 0)

    def test_empty_terms_file_is_bad_input(self):
        terms = self.root.parent / 'terms.txt'
        terms.write_text('# nothing\n', encoding='utf-8')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(forbidden_terms.main(['--terms', str(terms), '--root', str(self.root)]), 2)


if __name__ == '__main__':
    unittest.main()

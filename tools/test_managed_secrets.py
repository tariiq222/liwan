# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hermetic local file tests for managed secret handles; no secret output."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

if importlib.util.find_spec('nasq_cli.managed_secrets'):
    from nasq_cli import managed_secrets as secrets
else:
    secrets = None

VALUE = 'synthetic_secret_value_0123456789'


class ManagedSecretsCase(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(secrets, 'managed_secrets missing: intended RED')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / 'secret'
        self.path.write_bytes(VALUE.encode())
        self.path.chmod(0o600)

    def refuse(self, path=None):
        with self.assertRaises(secrets.SecretError) as caught:
            secrets.resolve_secret(str(path or self.path))
        error = caught.exception
        self.assertIsInstance(error, OSError)
        self.assertEqual(str(error), 'secret_unavailable')
        self.assertEqual(error.args, ('secret_unavailable',))
        self.assertIsNone(error.filename)
        self.assertNotIn(VALUE, str(error))
        self.assertNotIn(str(self.root), str(error))
        self.assertTrue(error.__suppress_context__)

    def test_private_owned_files_and_trim(self):
        for mode in [0o400, 0o600]:
            self.path.chmod(0o600)
            self.path.write_text(' \n' + VALUE + '\n ')
            self.path.chmod(mode)
            self.assertEqual(secrets.resolve_secret(str(self.path)), VALUE)

    def test_only_exact_private_readable_modes(self):
        for mode in [0o644, 0o640, 0o604, 0o666, 0o700, 0o200, 0o000, 0o4600]:
            self.path.chmod(mode)
            self.refuse()
        self.path.chmod(0o600)

    def test_wrong_owner(self):
        with patch.object(secrets.os, 'getuid', return_value=os.getuid() + 1):
            self.refuse()

    def test_final_and_parent_symlinks(self):
        link = self.root / 'link'
        link.symlink_to(self.path)
        self.refuse(link)
        directory = self.root / 'real'
        directory.mkdir()
        target = directory / 'key'
        target.write_text(VALUE)
        target.chmod(0o600)
        alias = self.root / 'alias'
        alias.symlink_to(directory, target_is_directory=True)
        self.refuse(alias / 'key')

    def test_noncanonical_and_nonstring_paths(self):
        for value in ['relative', str(self.root) + '//secret', str(self.root) + '/./secret',
                      str(self.root) + '/missing/../secret', str(self.path) + '/',
                      '/', '', None, 1, str(self.path) + '\x00']:
            with self.subTest(value_type=type(value).__name__), self.assertRaises(secrets.SecretError):
                secrets.resolve_secret(value)

    def test_missing_file_parent_and_directory(self):
        for value in [self.root / 'absent', self.root / 'absent' / 'key', self.root]:
            self.refuse(value)

    def test_fifo_refused_before_open(self):
        fifo = self.root / 'pipe'
        os.mkfifo(fifo, 0o600)
        original = os.open

        def guarded(path, *args, **kwargs):
            if path == 'pipe':
                self.fail('FIFO must be refused before opening')
            return original(path, *args, **kwargs)
        with patch.object(secrets.os, 'open', side_effect=guarded):
            self.refuse(fifo)

    def test_size_and_utf8_and_secret_sanity(self):
        for raw in [b'a' * 4097, b'\xff', b'', b'admin', b'a' * 24,
                    b'long_change-me_placeholder_123456789', b'x' * 257,
                    (VALUE + '!').encode(), ('a' * 23).encode()]:
            self.path.write_bytes(raw)
            self.refuse()

    def test_bounded_read_rejects_growth(self):
        with patch.object(secrets.os, 'read', return_value=b'x' * 4097) as read:
            self.refuse()
        self.assertLessEqual(read.call_args.args[1], 4097)

    def test_short_reads_are_accumulated_and_truncation_refused(self):
        original = os.read
        with patch.object(secrets.os, 'read', side_effect=lambda fd, count: original(fd, min(count, 5))):
            self.assertEqual(secrets.resolve_secret(str(self.path)), VALUE)
        with patch.object(secrets.os, 'read', return_value=b''):
            self.refuse()

    def test_post_open_permissions_are_rechecked(self):
        original = os.open

        def changed(path, flags, **kwargs):
            if path == 'secret':
                self.path.chmod(0o644)
            return original(path, flags, **kwargs)
        with patch.object(secrets.os, 'open', side_effect=changed):
            self.refuse()

    def test_inode_swap_refused_after_open(self):
        other = self.root / 'other'
        other.write_text(VALUE)
        other.chmod(0o600)
        original = os.open

        def replaced(path, flags, **kwargs):
            if path == 'secret':
                return original('other', flags, **kwargs)
            return original(path, flags, **kwargs)
        with patch.object(secrets.os, 'open', side_effect=replaced):
            self.refuse()

    def test_read_exception_is_sanitized(self):
        with patch.object(secrets.os, 'read', side_effect=OSError(VALUE)):
            self.refuse()

    def test_file_descriptors_are_closed_on_success_and_failure(self):
        original_open, original_close = os.open, os.close
        opened, closed = [], []

        def tracked_open(*args, **kwargs):
            fd = original_open(*args, **kwargs)
            opened.append(fd)
            return fd

        def tracked_close(fd):
            closed.append(fd)
            return original_close(fd)
        for fail in [False, True]:
            opened.clear()
            closed.clear()
            with patch.object(secrets.os, 'open', side_effect=tracked_open), patch.object(secrets.os, 'close', side_effect=tracked_close):
                if fail:
                    with patch.object(secrets.os, 'read', side_effect=OSError(VALUE)):
                        self.refuse()
                else:
                    self.assertEqual(secrets.resolve_secret(str(self.path)), VALUE)
            self.assertCountEqual(opened, closed)


if __name__ == '__main__':
    unittest.main()

# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the bucket half promises, proven offline against an in-memory source.

Every rule here is checked by a test that fails when the rule is removed: the index is one
``<sha256>  <key>`` line per object in key order and the same bytes for the same input, a
missing object or a size the listing did not report is a refusal, a key that could leave
the root is a refusal, and ``populate`` fails when the object read back is not the one it
wrote. Nothing here opens a socket, starts a database, or holds a credential.
"""
from __future__ import annotations

import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from deploy.backup import bucket
from deploy.backup.artifact import CONTENTS_MEMBER, OBJECTS_DIRECTORY
from deploy.backup.bucket import BucketManifest, ObjectMeta
from deploy.backup.errors import BackupError
from deploy.s3_client import StorageError

SECRET = 'LIWAN-test-secret-that-must-never-appear'


class MemoryBucket:
    """A bucket in memory: the three operations, holding the key like a real source."""

    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.secret = SECRET

    def list(self, prefix: str) -> list[ObjectMeta]:
        return [
            ObjectMeta(key=key, size=len(value))
            for key, value in sorted(self.objects.items()) if key.startswith(prefix)
        ]

    def get_file(self, key: str, target: Path) -> None:
        if key not in self.objects:
            message = f'object not found: {key}'
            raise StorageError(message)
        Path(target).write_bytes(self.objects[key])

    def put_file(self, key: str, source: Path) -> None:
        self.objects[key] = Path(source).read_bytes()


class FixedListing(MemoryBucket):
    """A source whose listing reports sizes its objects do not have."""

    def __init__(self, objects: dict[str, bytes], sizes: dict[str, int]) -> None:
        super().__init__(objects)
        self.sizes = sizes

    def list(self, prefix: str) -> list[ObjectMeta]:
        return [
            ObjectMeta(key=key, size=self.sizes[key])
            for key in sorted(self.objects) if key.startswith(prefix)
        ]


class DriftingRead(MemoryBucket):
    """A bucket that returns the written bytes plus one: a read-back that does not match."""

    def get_file(self, key: str, target: Path) -> None:
        Path(target).write_bytes(self.objects[key] + b'!')


class BucketCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix='liwan-bucket-')).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)

    def destination(self, name: str = 'artifact') -> Path:
        path = self.root / name
        path.mkdir()
        return path

    def digests(self, objects: dict[str, bytes]) -> dict[str, str]:
        return {key: hashlib.sha256(value).hexdigest() for key, value in objects.items()}


class TestIndex(BucketCase):
    def test_it_is_one_sorted_line_per_object(self):
        objects = [ObjectMeta(key='ab/cdef', size=3), ObjectMeta(key='aa/bb', size=5)]
        index = bucket.index_bytes(objects, {'ab/cdef': 'b' * 64, 'aa/bb': 'a' * 64})
        self.assertEqual(index, (f"{'a' * 64}  aa/bb\n{'b' * 64}  ab/cdef\n").encode('ascii'))

    def test_the_same_objects_produce_the_same_bytes_whatever_their_order(self):
        digests = {'ab/cdef': 'b' * 64, 'aa/bb': 'a' * 64}
        first = bucket.index_bytes([ObjectMeta('ab/cdef', 3), ObjectMeta('aa/bb', 5)], digests)
        second = bucket.index_bytes([ObjectMeta('aa/bb', 5), ObjectMeta('ab/cdef', 3)], digests)
        self.assertEqual(first, second)

    def test_it_uses_the_tree_digest_convention(self):
        root = self.destination('objects')
        (root / 'ab').mkdir()
        (root / 'ab' / 'cdef').write_bytes(b'attachment payload')
        manifest = bucket.tree_manifest(root)
        self.assertEqual(manifest.index, b'%s  ab/cdef\n' % (
            hashlib.sha256(b'attachment payload').hexdigest().encode('ascii'),
        ))
        self.assertEqual(manifest.index_sha256, hashlib.sha256(manifest.index).hexdigest())
        self.assertEqual((manifest.object_count, manifest.object_bytes),
                         (1, len(b'attachment payload')))

    def test_a_key_that_is_an_ancestor_of_another_key_is_refused(self):
        for keys in (
            ('a', 'a/b'),
            ('a', 'a-1', 'a/b'),
            ('a/b', 'a/b/c/d'),
        ):
            with self.subTest(keys=keys):
                objects = [ObjectMeta(key, 1) for key in keys]
                with self.assertRaises(BackupError) as refused:
                    bucket.require_objects(objects)
                self.assertIn(keys[0], str(refused.exception))
                self.assertIn(keys[-1], str(refused.exception))
        # Keys that share a string prefix without a path boundary do not collide.
        ordered = bucket.require_objects([ObjectMeta('ab', 1), ObjectMeta('a', 1)])
        self.assertEqual([meta.key for meta in ordered], ['a', 'ab'])

    def test_a_duplicate_key_is_refused(self):
        objects = [ObjectMeta('ab/cdef', 3), ObjectMeta('ab/cdef', 3)]
        with self.assertRaises(BackupError):
            bucket.index_bytes(objects, {'ab/cdef': 'a' * 64})
        with self.assertRaises(BackupError):
            bucket.totals(objects)

    def test_a_key_that_could_leave_the_root_is_refused(self):
        for key in ('../escape', '/absolute', 'a//b', 'a/./b', 'a\\b', ''):
            with self.subTest(key=key), self.assertRaises(BackupError):
                bucket.index_bytes([ObjectMeta(key, 1)], {key: 'a' * 64})

    def test_a_control_character_in_a_key_is_refused(self):
        for key in ('a\nb', 'a\rb', 'a\tb', 'a\x00b', 'a\x7fb'):
            with self.subTest(key=key), self.assertRaises(BackupError):
                bucket.require_object_key(key)
            with self.subTest(key=key), self.assertRaises(BackupError):
                bucket.index_bytes([ObjectMeta(key, 1)], {key: 'a' * 64})

    def test_the_refusal_does_not_echo_the_control_character(self):
        with self.assertRaises(BackupError) as refused:
            bucket.require_object_key('a\tb')
        self.assertIn('control character', str(refused.exception))
        self.assertNotIn('\t', str(refused.exception))
        self.assertNotIn('a\tb', str(refused.exception))

    def test_the_single_key_that_forged_a_second_index_line_is_refused(self):
        first, second = 'a' * 64, 'b' * 64
        forged_key = f'ab\n{second}  cd/ef'
        with self.assertRaises(BackupError):
            bucket.index_bytes([ObjectMeta(forged_key, 1)], {forged_key: first})

    def test_an_object_without_a_digest_or_with_a_short_one_is_refused(self):
        objects = [ObjectMeta('ab/cdef', 3)]
        for digests in ({}, {'ab/cdef': 'nothex'}, {'ab/cdef': 'A' * 64}):
            with self.subTest(digests=digests), self.assertRaises(BackupError):
                bucket.index_bytes(objects, digests)


class TestCopyOut(BucketCase):
    def test_it_writes_the_index_and_every_object(self):
        source = MemoryBucket({'ab/cdef': b'attachment', 'aa/bb': b'second'})
        destination = self.destination()
        manifest = bucket.copy_out(source, destination)
        self.assertEqual(sorted(path.name for path in destination.iterdir()),
                         sorted([CONTENTS_MEMBER, OBJECTS_DIRECTORY]))
        self.assertEqual((destination / OBJECTS_DIRECTORY / 'ab' / 'cdef').read_bytes(), b'attachment')
        self.assertEqual((destination / OBJECTS_DIRECTORY / 'aa' / 'bb').read_bytes(), b'second')
        self.assertEqual((destination / CONTENTS_MEMBER).read_bytes(), manifest.index)
        self.assertEqual(manifest.index_sha256, hashlib.sha256(manifest.index).hexdigest())
        self.assertEqual((manifest.object_count, manifest.object_bytes), (2, 16))

    def test_two_copies_of_the_same_bucket_are_byte_identical(self):
        source = MemoryBucket({'ab/cdef': b'attachment', 'aa/bb': b'second'})
        first, second = self.destination('first'), self.destination('second')
        bucket.copy_out(source, first)
        bucket.copy_out(source, second)
        self.assertEqual((first / CONTENTS_MEMBER).read_bytes(), (second / CONTENTS_MEMBER).read_bytes())
        for key in ('ab/cdef', 'aa/bb'):
            self.assertEqual((first / OBJECTS_DIRECTORY / key).read_bytes(),
                             (second / OBJECTS_DIRECTORY / key).read_bytes())

    def test_the_empty_source_writes_the_empty_index(self):
        destination = self.destination()
        manifest = bucket.copy_out(None, destination)
        self.assertEqual((destination / CONTENTS_MEMBER).read_bytes(), b'')
        self.assertEqual(manifest, BucketManifest(index=b'', index_sha256=hashlib.sha256(b'').hexdigest(),
                                                 object_count=0, object_bytes=0))

    def test_an_existing_copy_is_not_overwritten(self):
        source = MemoryBucket({'ab/cdef': b'attachment'})
        destination = self.destination()
        bucket.copy_out(source, destination)
        with self.assertRaises(BackupError):
            bucket.copy_out(source, destination)

    def test_a_missing_object_is_refused_and_no_index_is_written(self):
        class Short(MemoryBucket):
            def list(self, prefix):
                return [ObjectMeta('ab/cdef', 10), ObjectMeta('cd/missing', 7)]

        destination = self.destination()
        with self.assertRaises(BackupError):
            bucket.copy_out(Short({'ab/cdef': b'attachment'}), destination)
        self.assertFalse((destination / CONTENTS_MEMBER).exists())

    def test_a_size_the_listing_did_not_report_is_refused(self):
        source = FixedListing({'ab/cdef': b'attachment'}, {'ab/cdef': 99})
        with self.assertRaises(BackupError):
            bucket.copy_out(source, self.destination())

    def test_a_duplicate_key_from_the_listing_is_refused_before_any_read(self):
        class Twice(MemoryBucket):
            def list(self, prefix):
                return [ObjectMeta('ab/cdef', 3), ObjectMeta('ab/cdef', 3)]

        destination = self.destination()
        with self.assertRaises(BackupError):
            bucket.copy_out(Twice({'ab/cdef': b'x'}), destination)
        self.assertEqual(list(destination.iterdir()), [])

    def test_a_key_that_could_leave_the_root_is_refused_before_any_read(self):
        for key in ('../escape', '/absolute'):
            with self.subTest(key=key), self.assertRaises(BackupError):
                bucket.copy_out(MemoryBucket({key: b'x'}), self.destination(key.replace('/', '-')))

    def test_colliding_ancestor_and_child_keys_raise_backup_error_before_any_read(self):
        destination = self.destination('collide')
        with self.assertRaises(BackupError) as refused:
            bucket.copy_out(MemoryBucket({'a': b'x', 'a/b': b'y'}), destination)
        self.assertIn('a', str(refused.exception))
        self.assertIn('a/b', str(refused.exception))
        self.assertEqual(list(destination.iterdir()), [])

    def test_zero_byte_objects_copy_out_with_positive_count_and_zero_bytes(self):
        source = MemoryBucket({'ab/empty': b'', 'cd/marker': b''})
        destination = self.destination('zeros')
        manifest = bucket.copy_out(source, destination)
        self.assertEqual((manifest.object_count, manifest.object_bytes), (2, 0))
        self.assertEqual((destination / OBJECTS_DIRECTORY / 'ab' / 'empty').read_bytes(), b'')
        self.assertEqual((destination / OBJECTS_DIRECTORY / 'cd' / 'marker').read_bytes(), b'')


class TestCompare(BucketCase):
    def copied(self) -> tuple[Path, bytes]:
        destination = self.destination()
        manifest = bucket.copy_out(MemoryBucket({'ab/cdef': b'attachment', 'aa/bb': b'second'}), destination)
        return destination / OBJECTS_DIRECTORY, manifest.index

    def test_the_tree_the_index_describes_has_no_difference(self):
        objects, index = self.copied()
        self.assertEqual(bucket.compare(index, objects), [])

    def test_a_missing_a_changed_and_an_extra_object_are_all_named(self):
        objects, index = self.copied()
        (objects / 'ab' / 'cdef').unlink()
        (objects / 'aa' / 'bb').write_bytes(b'different bytes')
        (objects / 'cd').mkdir()
        (objects / 'cd' / 'extra').write_bytes(b'extra')
        self.assertEqual(bucket.compare(index, objects), ['aa/bb', 'ab/cdef', 'cd/extra'])

    def test_a_symlink_in_the_tree_is_refused(self):
        objects, index = self.copied()
        (objects / 'cd').symlink_to('/etc/hosts')
        with self.assertRaises(BackupError):
            bucket.compare(index, objects)

    def test_a_malformed_or_repeated_index_is_refused(self):
        objects, index = self.copied()
        for malformed in (b'not an index\n', index + index.split(b'\n')[0] + b'\n'):
            with self.subTest(malformed=malformed), self.assertRaises(BackupError):
                bucket.compare(malformed, objects)

    def test_a_forged_index_line_is_refused_on_read(self):
        digest, other = 'a' * 64, 'b' * 64
        forged = (
            f'{digest} ab/cdef\n',          # one space, not two
            f'{digest}  ab\tcdef\n',        # a tab inside the key
            f'{digest}  ab\rcdef\n',        # a carriage return inside the key
            f'{digest}  ab\x00cdef\n',      # a NUL inside the key
            f'{digest}  ab/cdef',           # no final newline
            f'{digest}  ab/cdef\n\n{other}  aa/bb\n',  # a blank line between objects
        )
        for index in forged:
            with self.subTest(index=index), self.assertRaises(BackupError):
                bucket.parse_index(index.encode('latin-1'))
        self.assertEqual(bucket.parse_index(b''), {})
        self.assertEqual(bucket.parse_index(f'{digest}  ab/cdef\n'.encode('ascii')),
                         {'ab/cdef': digest})


class TestPopulate(BucketCase):
    def artifact(self, objects: dict[str, bytes] | None = None) -> tuple[Path, str]:
        destination = self.destination()
        payload = objects if objects is not None else {'ab/cdef': b'attachment', 'aa/bb': b'second'}
        manifest = bucket.copy_out(MemoryBucket(payload), destination)
        return destination, manifest.index_sha256

    def test_it_writes_every_object_and_reads_it_back(self):
        artifact, digest = self.artifact()
        target = MemoryBucket()
        bucket.populate(artifact, target, digest)
        self.assertEqual(target.objects, {'ab/cdef': b'attachment', 'aa/bb': b'second'})

    def test_zero_byte_objects_populate_and_verify(self):
        artifact, digest = self.artifact({'ab/empty': b'', 'cd/marker': b''})
        target = MemoryBucket()
        bucket.populate(artifact, target, digest)
        self.assertEqual(target.objects, {'ab/empty': b'', 'cd/marker': b''})

    def test_a_wrong_index_digest_is_refused_before_any_write(self):
        artifact, digest = self.artifact()
        target = MemoryBucket()
        other = 'f' * 64
        self.assertNotEqual(other, digest)
        with self.assertRaisesRegex(BackupError, 'pinned manifest digest'):
            bucket.populate(artifact, target, other)
        self.assertEqual(target.objects, {})
        # Even a self-consistent tampered artifact is refused when its index digest does not match.
        (artifact / OBJECTS_DIRECTORY / 'ab' / 'cdef').write_bytes(b'forged')
        tampered = bucket.tree_manifest(artifact / OBJECTS_DIRECTORY)
        (artifact / CONTENTS_MEMBER).write_bytes(tampered.index)
        with self.assertRaisesRegex(BackupError, 'pinned manifest digest'):
            bucket.populate(artifact, target, digest)
        self.assertEqual(target.objects, {})

    def test_a_malformed_or_zeroed_expected_digest_is_refused_before_any_write(self):
        artifact, _digest = self.artifact()
        target = MemoryBucket()
        for bad in ('', 'not-hex', '0' * 64):
            with self.subTest(bad=bad), self.assertRaises(BackupError):
                bucket.populate(artifact, target, bad)
        self.assertEqual(target.objects, {})

    def test_a_short_artifact_is_refused_before_any_write(self):
        artifact, digest = self.artifact()
        (artifact / OBJECTS_DIRECTORY / 'ab' / 'cdef').unlink()
        target = MemoryBucket()
        with self.assertRaisesRegex(BackupError, 'short of') as refused:
            bucket.populate(artifact, target, digest)
        self.assertIn('ab/cdef', str(refused.exception))
        self.assertNotIn('does not name', str(refused.exception))
        self.assertEqual(target.objects, {})

    def test_an_extra_object_is_refused_with_its_own_message(self):
        artifact, digest = self.artifact()
        (artifact / OBJECTS_DIRECTORY / 'cd').mkdir()
        (artifact / OBJECTS_DIRECTORY / 'cd' / 'extra').write_bytes(b'extra')
        target = MemoryBucket()
        with self.assertRaises(BackupError) as refused:
            bucket.populate(artifact, target, digest)
        self.assertIn('does not name', str(refused.exception))
        self.assertIn('cd/extra', str(refused.exception))
        self.assertNotIn('short of', str(refused.exception))
        self.assertEqual(target.objects, {})

    def test_a_read_back_that_differs_fails_the_populate(self):
        artifact, digest = self.artifact()
        with self.assertRaisesRegex(BackupError, 'aa/bb'):
            bucket.populate(artifact, DriftingRead(), digest)

    def test_an_artifact_without_its_index_is_refused(self):
        artifact, digest = self.artifact()
        (artifact / CONTENTS_MEMBER).unlink()
        with self.assertRaises(BackupError):
            bucket.populate(artifact, MemoryBucket(), digest)


class TestDirectoryBucketWrite(BucketCase):
    def payload(self, content: bytes = b'payload') -> Path:
        path = self.root / 'payload'
        path.write_bytes(content)
        return path

    def test_a_new_object_is_written_under_its_key(self):
        root = self.destination('bucket')
        bucket.DirectoryBucket(root).put_file('ab/cdef', self.payload())
        self.assertEqual((root / 'ab' / 'cdef').read_bytes(), b'payload')
        self.assertFalse((root / 'ab' / 'cdef').is_symlink())

    def test_an_existing_object_is_not_overwritten(self):
        root = self.destination('bucket')
        target = bucket.DirectoryBucket(root)
        target.put_file('ab/cdef', self.payload())
        with self.assertRaises(BackupError):
            target.put_file('ab/cdef', self.payload(b'second'))
        self.assertEqual((root / 'ab' / 'cdef').read_bytes(), b'payload')

    def test_a_symlinked_target_is_refused_and_nothing_is_written_outside(self):
        root = self.destination('bucket')
        outside = self.root / 'outside'
        outside.write_bytes(b'original')
        (root / 'ab').mkdir()
        (root / 'ab' / 'cdef').symlink_to(outside)
        with self.assertRaises(BackupError):
            bucket.DirectoryBucket(root).put_file('ab/cdef', self.payload(b'pwned'))
        self.assertEqual(outside.read_bytes(), b'original')
        self.assertTrue((root / 'ab' / 'cdef').is_symlink())

    def test_a_symlinked_parent_is_refused_and_nothing_is_written_outside(self):
        root = self.destination('bucket')
        outside = self.destination('outside')
        (root / 'ab').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(BackupError):
            bucket.DirectoryBucket(root).put_file('ab/cdef', self.payload(b'pwned'))
        self.assertEqual(list(outside.iterdir()), [])


class TestNoSecret(BucketCase):
    def test_no_secret_reaches_a_manifest_or_a_message(self):
        source = MemoryBucket({'ab/cdef': b'attachment'})
        destination = self.destination()
        manifest = bucket.copy_out(source, destination)
        self.assertNotIn(SECRET, repr(manifest))
        self.assertNotIn(SECRET, repr(ObjectMeta('ab/cdef', 3)))
        self.assertEqual(set(manifest.payload()), {
            'contents_sha256', 'contents_object_count', 'contents_object_bytes',
        })
        self.assertNotIn(SECRET, (destination / CONTENTS_MEMBER).read_text(encoding='ascii'))

        class Missing(MemoryBucket):
            def list(self, prefix):
                return [ObjectMeta('ab/cdef', 3), ObjectMeta('cd/absent', 1)]

        with self.assertRaises(BackupError) as refused:
            bucket.copy_out(Missing({'ab/cdef': b'attachment'}), self.destination('second'))
        self.assertNotIn(SECRET, str(refused.exception))


if __name__ == '__main__':
    unittest.main()

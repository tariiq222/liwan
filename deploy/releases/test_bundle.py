"""A running release survives rebuild of its original Nitro output."""
from pathlib import Path
import tempfile
import unittest
from . import bundle


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.output = self.root / 'output'
        (self.output / 'server').mkdir(parents=True)
        (self.output / 'public/_nuxt').mkdir(parents=True)
        (self.output / 'server/index.mjs').write_text('export const release = "old"')
        (self.output / 'public/_nuxt/Abc12345.js').write_text('old asset')
        self.releases = self.root / 'releases'

    def test_original_rebuild_cannot_change_prepared_server_or_old_assets(self):
        receipt = bundle.prepare_bundle(self.output, self.releases, 'release_a', 'a' * 64)
        (self.output / 'server/index.mjs').write_text('new build')
        (self.output / 'public/_nuxt/Abc12345.js').unlink()
        prepared = self.releases / 'release_a'
        self.assertEqual((prepared / 'server/index.mjs').read_text(), 'export const release = "old"')
        self.assertEqual((prepared / 'public/_nuxt/Abc12345.js').read_text(), 'old asset')
        self.assertEqual(bundle.verify_bundle(prepared, 'a' * 64), receipt)
        with self.assertRaises(ValueError): bundle.prepare_bundle(self.output, self.releases, 'release_a', 'b' * 64)

    def test_tampered_bundle_or_wrong_source_is_rejected(self):
        bundle.prepare_bundle(self.output, self.releases, 'release_a', 'a' * 64)
        with self.assertRaises(ValueError): bundle.verify_bundle(self.releases / 'release_a', 'b' * 64)
        path = self.releases / 'release_a/server/index.mjs'
        path.chmod(0o644); path.write_text('tampered')
        with self.assertRaises(ValueError): bundle.verify_bundle(self.releases / 'release_a', 'a' * 64)

    def test_internal_dependency_links_are_copied_and_external_links_refused(self):
        target = self.output / 'server/dependency.mjs'; target.write_text('dependency')
        (self.output / 'server/link.mjs').symlink_to('dependency.mjs')
        bundle.prepare_bundle(self.output, self.releases, 'release_a', 'a' * 64)
        copied = self.releases / 'release_a/server/link.mjs'
        self.assertFalse(copied.is_symlink()); self.assertEqual(copied.read_text(), 'dependency')
        (self.output / 'server/escape').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): bundle.prepare_bundle(self.output, self.releases, 'release_b', 'a' * 64)
        self.assertFalse((self.releases / 'release_b').exists())

    def test_missing_entrypoint_or_assets_and_nested_destination_refused(self):
        (self.output / 'server/index.mjs').unlink()
        with self.assertRaises(ValueError): bundle.prepare_bundle(self.output, self.releases, 'release_a', 'a' * 64)
        with self.assertRaises(ValueError): bundle.prepare_bundle(self.output, self.output / 'releases', 'release_a', 'a' * 64)

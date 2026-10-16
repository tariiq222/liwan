"""Publish actual file bytes with immutable names and source receipts."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from .assets import publish_assets


class AssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = self.root / 'store'

    def source(self, name, files):
        root = self.root / name; root.mkdir()
        for path, content in files.items():
            target = root / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
        return root

    def test_old_chunk_remains_after_new_publication_and_receipt_hashes_exact_bytes(self):
        before = self.source('before', {'_nuxt/Abc12345.js': b'old-js', '_nuxt/entry.Def67890.css': b'old-css'})
        after = self.source('after', {'_nuxt/Zyx98765.js': b'new-js'})
        receipt = publish_assets(before, self.store, 'release_one')
        publish_assets(after, self.store, 'release_two')
        self.assertEqual((self.store / '_nuxt/Abc12345.js').read_bytes(), b'old-js')
        self.assertEqual((self.store / '_nuxt/Zyx98765.js').read_bytes(), b'new-js')
        self.assertEqual(receipt['assets']['/_nuxt/Abc12345.js']['sha256'], hashlib.sha256(b'old-js').hexdigest())
        self.assertEqual(json.loads((self.store / 'releases/release_one.json').read_text()), receipt)
        self.assertEqual(publish_assets(before, self.store, 'release_one'), receipt)

    def test_name_collision_and_release_identity_collision_do_not_overwrite(self):
        before = self.source('before', {'_nuxt/Abc12345.js': b'old'})
        after = self.source('after', {'_nuxt/Abc12345.js': b'different'})
        publish_assets(before, self.store, 'release_one')
        with self.assertRaises(ValueError): publish_assets(after, self.store, 'release_two')
        self.assertEqual((self.store / '_nuxt/Abc12345.js').read_bytes(), b'old')
        after = self.source('third', {'_nuxt/New12345.js': b'new'})
        with self.assertRaises(ValueError): publish_assets(after, self.store, 'release_one')
        self.assertFalse((self.store / '_nuxt/New12345.js').exists())

    def test_nested_hashed_i18n_and_stable_identical_fonts_are_retained(self):
        files = {'_i18n/Abc12345/ar.json': b'{"greeting":"hello"}',
                 'fonts/Arabic-Regular.woff2': b'font', '_nuxt/Abc12345.js': b'js'}
        receipt = publish_assets(self.source('first', files), self.store, 'release_one')
        self.assertTrue(receipt['assets']['/_i18n/Abc12345/ar.json']['immutable'])
        self.assertFalse(receipt['assets']['/fonts/Arabic-Regular.woff2']['immutable'])
        publish_assets(self.source('second', files), self.store, 'release_two')
        files['fonts/Arabic-Regular.woff2'] = b'new-font'
        with self.assertRaises(ValueError): publish_assets(self.source('third', files), self.store, 'release_three')

    def test_unhashed_metadata_is_explicitly_unsupported_and_changes_source_digest(self):
        first = self.source('first', {'_nuxt/Abc12345.js': b'js', '_nuxt/builds/latest.json': b'old', 'favicon.ico': b'icon'})
        receipt = publish_assets(first, self.store, 'release_one')
        self.assertEqual(receipt['unsupported'], ['/_nuxt/builds/latest.json', '/favicon.ico'])
        self.assertFalse((self.store / '_nuxt/builds/latest.json').exists())
        (first / 'favicon.ico').write_bytes(b'changed')
        second = publish_assets(first, self.store, 'release_two')
        self.assertNotEqual(receipt['sourceDigest'], second['sourceDigest'])

    def test_unique_build_metadata_retained_and_latest_stays_explicitly_dynamic(self):
        name = '_nuxt/builds/meta/11111111-1111-4111-8111-111111111111.json'
        first = self.source('first', {name: b'old-meta', '_nuxt/builds/latest.json': b'old-latest'})
        receipt = publish_assets(first, self.store, 'release_one')
        self.assertTrue(receipt['assets']['/' + name]['immutable'])
        self.assertIn('/_nuxt/builds/latest.json', receipt['unsupported'])
        publish_assets(self.source('second', {'_nuxt/Abc12345.js': b'new'}), self.store, 'release_two')
        self.assertEqual((self.store / name).read_bytes(), b'old-meta')
        with self.assertRaises(ValueError):
            publish_assets(self.source('third', {name: b'changed-meta'}), self.store, 'release_three')

    def test_symlinks_unusual_sources_and_unsafe_release_id_refuse(self):
        source = self.source('first', {'_nuxt/Abc12345.js': b'js'})
        (source / '_nuxt/link.js').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): publish_assets(source, self.store, 'release_one')
        (source / '_nuxt/link.js').unlink()
        with self.assertRaises(ValueError): publish_assets(source, self.store, '../escape')
        self.store.symlink_to(source, target_is_directory=True)
        with self.assertRaises(ValueError): publish_assets(source, self.store, 'release_one')


if __name__ == '__main__': unittest.main()

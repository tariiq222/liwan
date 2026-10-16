# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path

import no_external_refs
from no_external_refs import find_external_refs


class TestNoExternalRefs(unittest.TestCase):
    def test_flags_runtime_hosts(self):
        text = "@import url('https://fonts.googleapis.com/css2?family=X');\n<script src=\"//cdn.jsdelivr.net/x.js\">"
        self.assertEqual([n for _, n in find_external_refs('a.css', text)], [1, 2])

    def test_ignores_namespaces_and_reserved_example_hosts(self):
        text = '<svg xmlns="http://www.w3.org/2000/svg">\nconst u = "https://example.invalid/docs"\n'
        self.assertEqual(find_external_refs('a.vue', text), [])

    def test_scans_the_ui_layer(self):
        import no_external_refs
        for root in ('packages/ui/app', 'packages/ui/public', 'packages/ui/nuxt.config.ts'):
            self.assertIn(root, no_external_refs.ROOTS)
        self.assertEqual(find_external_refs('packages/ui/app/assets/css/main.css', "@import url('https://fonts.googleapis.com/x.css');"),
                         [('packages/ui/app/assets/css/main.css', 1)])

    def test_scans_the_commercial_ui_layer(self):
        import no_external_refs
        for root in ('packages/commercial-ui/app', 'packages/commercial-ui/nuxt.config.ts'):
            self.assertIn(root, no_external_refs.ROOTS)

    def test_scans_the_vendor_admin_app_and_catches_a_cdn_there(self):
        fixtures = {
            'apps/vendor-admin/app/pages/x.vue': '<script src="https://cdn.jsdelivr.net/x.js"></script>',
            'apps/vendor-admin/server/api/y.ts': "await $fetch('https://api.stripe.com/v1')",
            'apps/vendor-admin/public/z.html': '<link href="//fonts.googleapis.com/x.css">',
            'apps/vendor-admin/nuxt.config.ts': "export default { app: { head: { link: [{ href: 'https://fonts.gstatic.com/a' }] } } }",
        }
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as repo:
            os.chdir(repo)
            self.addCleanup(os.chdir, previous)
            for relative, text in fixtures.items():
                target = Path(relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding='utf-8')
            with contextlib.redirect_stderr(io.StringIO()) as err:
                code = no_external_refs.main()
        self.assertEqual(code, 1)
        for relative in fixtures:
            self.assertIn(f'external runtime reference: {relative}:1', err.getvalue())


if __name__ == '__main__':
    unittest.main()

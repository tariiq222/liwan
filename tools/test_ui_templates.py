# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""ui_templates.mjs resolves its scan roots from its own location, so each test runs a copy inside a scratch repo."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
NODE_MODULES = TOOLS.parent / 'node_modules'
ROOTS = ('apps/web/app', 'packages/ui/app', 'packages/commercial-ui/app', 'apps/vendor-admin/app')


@unittest.skipUnless(shutil.which('node') and (NODE_MODULES / '@vue/compiler-sfc').exists(), 'node or @vue/compiler-sfc missing')
class TestUiTemplates(unittest.TestCase):
    def run_in_scratch_repo(self, files):
        with tempfile.TemporaryDirectory() as scratch:
            repo = Path(scratch)
            (repo / 'tools').mkdir()
            shutil.copy(TOOLS / 'ui_templates.mjs', repo / 'tools')
            (repo / 'node_modules').symlink_to(NODE_MODULES)
            for root in ROOTS:
                (repo / root).mkdir(parents=True)
            for relative, text in files.items():
                (repo / relative).write_text(text, encoding='utf-8')
            return subprocess.run(['node', 'tools/ui_templates.mjs'], cwd=repo, capture_output=True, text=True, check=False)

    def test_valid_templates_in_every_root_pass(self):
        result = self.run_in_scratch_repo({root + '/ok.vue': '<template><p>ok</p></template>' for root in ROOTS})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('4 files, 0 errors', result.stdout)

    def test_a_broken_template_is_caught_in_each_root_including_vendor_admin(self):
        for root in ROOTS:
            with self.subTest(root=root):
                result = self.run_in_scratch_repo({root + '/broken.vue': '<template><div></template>'})
                self.assertEqual(result.returncode, 1)
                self.assertIn(root + '/broken.vue', result.stderr)


if __name__ == '__main__':
    unittest.main()

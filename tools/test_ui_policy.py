# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Policy regression checks: stdlib only; no app, database or Git mutations."""
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from ui_policy import check, main

APP = "apps/web/app/"
PAGE = APP + "pages/tasks.vue"
COMPONENT = APP + "components/shared/Example.vue"
MANIFEST = "apps/web/package.json"
CATALOG = "docs/design-system/components.md"


class UiPolicyTest(unittest.TestCase):
    def setUp(self):
        self.base = {
            APP + "components/ui/button/Button.vue": "<template><button /></template>",
            APP + "components/ui/sonner/index.ts": 'export { default as Toaster } from "./Sonner.vue"',
            PAGE: '<template><Button /></template>',
            MANIFEST: json.dumps({"dependencies": {"vue": "3", "reka-ui": "2", "vue-sonner": "2"}}),
            "package.json": '{}',
            CATALOG: '',
        }

    def errors(self, changes, head=None):
        return check(self.base | changes, self.base, self.base if head is None else head)

    def test_baseline_and_unrelated_copy_edit_pass(self):
        self.assertEqual(self.errors({PAGE: '<template><h1>المهام</h1><Button /></template>'}), [])

    def test_new_and_increased_legacy_consumers_fail(self):
        for change in (
            {PAGE: '<template><Button /><Button /></template>'},
            {APP + 'pages/new.vue': '<template><button /><Button /></template>'},
            {PAGE: '<template><Button/><lazy-ui-button/><ui-button/></template>'},
        ):
            with self.subTest(change=change):
                self.assertTrue(self.errors(change))

    def test_cannot_reintroduce_a_committed_removal(self):
        head = self.base | {PAGE: '<template><h1>المهام</h1></template>'}
        self.assertTrue(self.errors({}, head=head))

    def test_no_new_files_in_legacy_tree(self):
        self.assertTrue(self.errors({APP + 'components/ui/New.vue': '<template><div/></template>'}))

    def test_imports_aliases_reexports_and_static_dynamic_usage_fail(self):
        cases = [
            "import { Button as Action } from '@/components/ui/button'",
            "export { default } from '../components/ui/button/Button.vue'",
            "const c = import('../components/ui/button')",
            "const c = require('vue-sonner')",
            "import 'vue-sonner/style.css'",
            "const c = import('reka-ui/namespaced')",
            "import { Button as Action } from '#components'",
            "const c = resolveComponent('Toaster')",
            '<template><component :is="\'Button\'" /></template>',
            "import { DialogRoot } from 'reka-ui'",
        ]
        for source in cases:
            with self.subTest(source=source):
                self.assertTrue(self.errors({APP + 'pages/new.vue': source}))

    def test_comments_and_native_controls_are_not_legacy_tags(self):
        self.assertEqual(self.errors({PAGE: '<!-- <Button/> --><template><button/><Button/></template>'}), [])

    def test_vue_attributes_are_not_imports_but_scripts_and_styles_are_checked(self):
        source = '<script setup>const rows = computed<Button[]>(() => [])</script><template><div id="date-from" class="w-full" /></template>'
        self.assertEqual(self.errors({PAGE: source}), [])
        for extra in ('<script setup>import X from "unreviewed-library"</script>', '<style>@import "unreviewed-library";</style>'):
            self.assertTrue(self.errors({PAGE: source + extra}))

    def test_new_dependency_and_unknown_import_need_review(self):
        for name in ('vuetify', 'unreviewed-library'):
            with self.subTest(name=name):
                self.assertTrue(self.errors({MANIFEST: json.dumps({'dependencies': {name: '1'}})}))
                self.assertTrue(self.errors({PAGE: f"import X from '{name}'"}))

    def test_nuxt_ui_requires_manifest_and_registered_component(self):
        source = '<template><UButton>حفظ</UButton></template>'
        self.assertTrue(self.errors({COMPONENT: source}))
        manifest = json.loads(self.base[MANIFEST])
        manifest['dependencies']['@nuxt/ui'] = '4.11.1'
        changes = {COMPONENT: source, MANIFEST: json.dumps(manifest)}
        self.assertTrue(self.errors(changes))
        changes[CATALOG] = f'| `{COMPONENT}` | Shared action, form recipe, UButton |'
        self.assertEqual(self.errors(changes), [])

    def test_theme_literals_and_local_roots_fail_but_tokens_pass(self):
        for source in ('<style>.x { color: #123456; }</style>',
                       '<div class="bg-red-500"/>', '<div class="bg-[#abc]"/>',
                       '<style>:root { --color: red; }</style>',
                       '<style>@font-face { font-family: X; }</style>'):
            with self.subTest(source=source):
                self.assertTrue(self.errors({PAGE: source}))
        self.assertEqual(self.errors({PAGE: '<div class="bg-primary text-start ps-2"/>'}), [])

    def test_existing_literals_can_shrink_not_expand(self):
        self.base[PAGE] = '<style>.x { color: #abc; }</style>'
        self.assertEqual(self.errors({PAGE: '<template><div/></template>'}), [])
        self.assertTrue(self.errors({PAGE: self.base[PAGE] + '<style>.y { color: #def; }</style>'}))

    def test_catalog_does_not_excuse_bad_theme(self):
        self.assertTrue(self.errors({COMPONENT: '<div class="bg-red-500"/>',
                                     CATALOG: f'`{COMPONENT}`'}))

    def test_test_sources_excluded(self):
        self.assertEqual(self.errors({APP + 'utils/__tests__/ui.test.ts': "import 'vuetify'"}), [])

    def test_isolated_reference_uses_the_same_policy(self):
        path = 'apps/web/design-preview/app/components/Example.vue'
        self.assertTrue(self.errors({path: '<Button/>'}))
        self.assertTrue(self.errors({path: '<div class="bg-red-500"/>', CATALOG: f'`{path}`'}))
        self.assertEqual(self.errors({path: '<div class="bg-primary"/>', CATALOG: f'`{path}`'}), [])

    def test_cli_exit_codes_and_missing_history(self):
        for expected, current in ((0, self.base), (1, self.base | {PAGE: '<Button/><Button/>'})):
            with self.subTest(expected=expected), patch('ui_policy.snapshot', return_value=self.base), \
                    patch('ui_policy.current_snapshot', return_value=current), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(), expected)
                self.assertIn('PASS' if expected == 0 else 'FAIL', output.getvalue())
        with patch('ui_policy.snapshot', side_effect=ValueError('missing history')), \
                redirect_stderr(io.StringIO()) as output:
            self.assertEqual(main(), 2)
            self.assertIn('missing history', output.getvalue())


if __name__ == '__main__':
    unittest.main()

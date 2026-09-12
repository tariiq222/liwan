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
MAIN_CSS = APP + "assets/css/main.css"
LEGACY_CSS = APP + "assets/css/approved-shell.css"
LEGACY_CHART = APP + "components/ui/chart/ChartContainer.vue"
MIGRATED_CHART = APP + "components/charts/ChartContainer.vue"
PREVIEW_PAGE = "apps/web/design-preview/app/components/Example.vue"
ACCESS_EVENT = APP + "pages/settings/access-log/[eventId].vue"
REVIEWED_DATE = "@internationalized/date"
RETIRED_RENDERER = "@lucide/vue"


class UiPolicyTest(unittest.TestCase):
    def setUp(self):
        self.base = {
            APP + "components/ui/button/Button.vue": "<template><button /></template>",
            APP + "components/ui/sonner/index.ts": 'export { default as Toaster } from "./Sonner.vue"',
            LEGACY_CHART: '<template><ChartStyle /></template>',
            APP + "components/ui/chart/ChartLegendContent.vue": '<template><ChartLegendContent /></template>',
            APP + "components/ui/chart/ChartTooltipContent.vue": '<template><ChartTooltipContent /></template>',
            PAGE: '<template><Button /></template>',
            MANIFEST: json.dumps({"dependencies": {"vue": "3", "reka-ui": "2", "vue-sonner": "2", RETIRED_RENDERER: "1"}}),
            "package.json": '{}',
            CATALOG: '',
        }
        self.current = {
            PAGE: '<template><h1>المهام</h1></template>',
            MANIFEST: json.dumps({"dependencies": {
                "vue": "3",
                "reka-ui": "2",
                "vue-sonner": "2",
                "@nuxt/ui": "4.11.1",
                "@iconify-json/lucide": "1.2.129",
            }}),
            "package.json": '{}',
            CATALOG: '',
        }

    def errors(self, changes, head=None, current=None):
        snapshot = self.current if current is None else current
        return check(snapshot | changes, self.base, self.current if head is None else head)

    def test_baseline_and_unrelated_copy_edit_pass(self):
        self.assertEqual(self.errors({PAGE: '<template><h1>المهام</h1><button /></template>'}), [])

    def test_new_and_increased_legacy_consumers_fail(self):
        for change in (
            {PAGE: '<template><Button /><Button /></template>'},
            {APP + 'pages/new.vue': '<template><button /><Button /></template>'},
            {PAGE: '<template><Button/><lazy-ui-button/><ui-button/></template>'},
        ):
            with self.subTest(change=change):
                self.assertTrue(self.errors(change))

    def test_prohibited_legacy_consumer_is_not_grandfathered(self):
        current = self.current | {PAGE: '<template><Button /></template>'}
        self.assertTrue(self.errors({}, current=current, head=self.base))

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
        self.assertEqual(self.errors({PAGE: '<!-- <Button/> --><template><button/><input type="file" class="hidden" /></template>'}), [])

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
        manifest['dependencies'].pop(RETIRED_RENDERER)
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
        self.assertTrue(self.errors({}, current=self.base))

    def test_catalog_does_not_excuse_bad_theme(self):
        self.assertTrue(self.errors({COMPONENT: '<div class="bg-red-500"/>',
                                     CATALOG: f'`{COMPONENT}`'}))

    def test_test_sources_excluded(self):
        self.assertEqual(self.errors({APP + 'utils/__tests__/ui.test.ts': "import 'vuetify'"}), [])

    def test_design_preview_is_a_retired_source_tree(self):
        self.assertTrue(self.errors({PREVIEW_PAGE: '<template><div class="bg-primary" /></template>'}))

    def test_retired_css_owner_and_import_are_rejected(self):
        self.assertTrue(self.errors({LEGACY_CSS: '<style>.legacy { color: var(--foreground); }</style>'}))
        self.assertTrue(self.errors({MAIN_CSS: '@import "./approved-shell.css";'}))

    def test_current_theme_owners_can_define_theme_values(self):
        for path, source in (
            (MAIN_CSS, ':root { --brand: #123456; }'),
            (APP + 'assets/css/tokens.css', ':root { --brand: #123456; }'),
            (APP + 'assets/css/components.css', '.card { color: #123456; }'),
            (APP + 'assets/css/shell.css', '@font-face { font-family: Nasq; }'),
            (APP + 'utils/brandTheme.ts', 'export const brand = "#123456"'),
            (APP + 'app.config.ts', 'export default { ui: { colors: { primary: "#123456" } } }'),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.errors({path: source}), [])

    def test_retired_legacy_tree_is_rejected_even_when_it_matches_history(self):
        current = self.current | {
            LEGACY_CHART: '<template><div /></template>',
            PREVIEW_PAGE: '<template><div /></template>',
        }
        self.assertTrue(self.errors({}, current=current, head=self.base))

    def test_reka_is_limited_to_migrated_chart_adapters(self):
        chart = '<script setup lang="ts">import { Primitive } from "reka-ui"</script><template><Primitive /></template>'
        catalog = f'| `{MIGRATED_CHART}` | Chart adapter |'
        self.assertEqual(self.errors({MIGRATED_CHART: chart, CATALOG: catalog}), [])
        self.assertTrue(self.errors({COMPONENT: '<script setup>import { DialogRoot } from "reka-ui"</script>'}))

    def test_migrated_chart_import_is_allowed_but_stale_runtime_import_fails(self):
        catalog = '\n'.join((
            f'| `{MIGRATED_CHART}` | Chart adapter |',
            f'| `{APP}components/shared/DashboardChart.client.vue` | Dashboard chart owner |',
        ))
        self.assertEqual(self.errors({
            MIGRATED_CHART: '<template><div /></template>',
            APP + 'components/shared/DashboardChart.client.vue': '<script setup>import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "@/components/charts"</script><template><ChartContainer><ChartLegendContent /><ChartTooltipContent /></ChartContainer></template>',
            CATALOG: catalog,
        }), [])
        self.assertTrue(self.errors({
            APP + 'components/shared/DashboardChart.client.vue': 'import { ChartContainer } from "@/components/ui/chart"',
        }))

    def test_dependency_version_changes_need_review(self):
        manifest = json.loads(self.current[MANIFEST])
        manifest['dependencies']['vue'] = '4'
        self.assertTrue(self.errors({MANIFEST: json.dumps(manifest)}))

    def test_reviewed_head_dependency_is_allowed_without_opening_dependency_gate(self):
        manifest = json.loads(self.current[MANIFEST])
        manifest['dependencies'][REVIEWED_DATE] = '3.0.0'
        source = '<script setup>import { CalendarDate } from "@internationalized/date"</script><template><div /></template>'
        catalog = f'| `{COMPONENT}` | Shared date field |'
        self.assertEqual(self.errors({COMPONENT: source, MANIFEST: json.dumps(manifest), CATALOG: catalog}), [])

    def test_access_log_string_values_are_not_import_specifiers(self):
        source = "const returnTo = adminListQuery(route.query, ['from', 'to', 'actor_id'])"
        self.assertEqual(self.errors({ACCESS_EVENT: source}), [])

    def test_runtime_mock_and_fixture_imports_are_rejected_but_test_sources_are_excluded(self):
        for specifier in ('@/mocks/projects', '@/fixtures/projects', '../../e2e/fixtures/projects', '@/utils/__mocks__/api'):
            with self.subTest(specifier=specifier):
                self.assertTrue(self.errors({PAGE: f'import data from "{specifier}"'}))
        test_source = APP + 'pages/__tests__/fixtures.test.ts'
        self.assertEqual(self.errors({test_source: 'import data from "@/fixtures/projects"'}), [])

    def test_retired_lucide_renderer_cannot_return_as_dependency_or_runtime_import(self):
        manifest = json.loads(self.current[MANIFEST])
        manifest['dependencies'][RETIRED_RENDERER] = '1.41.0'
        self.assertTrue(self.errors({MANIFEST: json.dumps(manifest)}))
        self.assertTrue(self.errors({PAGE: f'import {{ Search }} from "{RETIRED_RENDERER}"'}))

    def test_cli_exit_codes_and_missing_history(self):
        for expected, current in ((0, self.current), (1, self.current | {PAGE: '<Button/><Button/>'})):
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

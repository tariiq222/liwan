# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Policy regression checks: stdlib only; no app, database or Git mutations."""
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import ui_policy as policy
from ui_policy import check, main, story_errors, story_warnings

APP = "apps/web/app/"
UI = "packages/ui/app/"
PAGE = APP + "pages/tasks.vue"
COMPONENT = APP + "components/shared/Example.vue"
MANIFEST = "apps/web/package.json"
CATALOG = "docs/design-system/components.md"
MAIN_CSS = UI + "assets/css/main.css"
LEGACY_CSS = UI + "assets/css/approved-shell.css"
LEGACY_CHART = APP + "components/ui/chart/ChartContainer.vue"
MIGRATED_CHART = APP + "components/charts/ChartContainer.vue"
PREVIEW_PAGE = "apps/web/design-preview/app/components/Example.vue"
ACCESS_EVENT = APP + "pages/settings/access-log/[eventId].vue"
REVIEWED_DATE = "@internationalized/date"
RETIRED_RENDERER = "@lucide/vue"
STORY = "apps/web/stories/shared/Example.stories.ts"
USAGE_PAGE = APP + "pages/example.vue"


class UiPolicyTest(unittest.TestCase):
    def setUp(self):
        # Task 11 filled the real STORYBOOK_COMPONENTS with the app's actual
        # component paths; these synthetic snapshots don't contain them, so
        # tests that aren't specifically exercising that list patch it back to
        # empty here and override it locally where needed.
        self._storybook_components_patch = patch("ui_policy.STORYBOOK_COMPONENTS", ())
        self._storybook_components_patch.start()
        self.addCleanup(self._storybook_components_patch.stop)
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

    def story(self, context="storyContext('apps/web/app/pages/example.vue:2')", target="../../app/components/shared/Example.vue"):
        return (
            "import Example from '" + target + "'\n"
            "import { storyContext } from '../support/context'\n"
            "export default { component: Example }\n"
            "export const InPage = { parameters: " + context + " }\n"
        )

    def story_snapshot(self, **changes):
        snapshot = {
            COMPONENT: "<template><p /></template>",
            USAGE_PAGE: "<template>\n  <SharedExample />\n</template>",
            STORY: self.story(),
        }
        snapshot.update(changes)
        return snapshot

    def test_retired_unification_patterns_fail(self):
        for markup in (
            '<template><p class="text-muted-foreground" /></template>',
            '<template><div class="border border-border" /></template>',
            '<template><UButton class="data-[active=true]:shadow-[inset_0_-2px_0_0_red]" /></template>',
            '<template><UIcon class="size-[18px]" /></template>',
            '<template><span class="text-[11px]" /></template>',
            '<template><div class="prose prose-sm" /></template>',
            '<template><div v-html="html" /></template>',
            '<template><label class="flex items-center gap-2 text-sm font-medium leading-none" /></template>',
        ):
            with self.subTest(markup=markup):
                self.assertTrue(self.errors({PAGE: markup}))

    def test_retired_pattern_lookalikes_and_owners_pass(self):
        self.assertEqual(self.errors({PAGE: '<template><p class="max-w-prose text-muted size-4.5 text-xs" /><!-- v-html="x" --></template>'}), [])
        rich_text = APP + "components/shared/form/RichText.vue"
        self.assertNotIn(
            rich_text + ': raw v-html; render stored HTML with SharedRichText (+1)',
            self.errors({rich_text: '<template><div v-html="rendered" /></template>', CATALOG: '`' + rich_text + '`'}),
        )

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
        self.assertTrue(self.errors({APP + "assets/css/approved-shell.css": "/* retired */"}))

    def test_current_theme_owners_can_define_theme_values(self):
        for path, source in (
            (MAIN_CSS, ':root { --brand: #123456; }'),
            (UI + 'assets/css/tokens.css', ':root { --brand: #123456; }'),
            (UI + 'assets/css/components.css', '.card { color: #123456; }'),
            (UI + 'assets/css/shell.css', '@font-face { font-family: Nasq; }'),
            (APP + 'utils/brandTheme.ts', 'export const brand = "#123456"'),
            (UI + 'app.config.ts', 'export default { ui: { colors: { primary: "#123456" } } }'),
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
            f'| `{APP}components/shared/data/DashboardChart.client.vue` | Dashboard chart owner |',
        ))
        self.assertEqual(self.errors({
            MIGRATED_CHART: '<template><div /></template>',
            APP + 'components/shared/data/DashboardChart.client.vue': '<script setup>import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "@/components/charts"</script><template><ChartContainer><ChartLegendContent /><ChartTooltipContent /></ChartContainer></template>',
            CATALOG: catalog,
        }), [])
        self.assertTrue(self.errors({
            APP + 'components/shared/data/DashboardChart.client.vue': 'import { ChartContainer } from "@/components/ui/chart"',
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

    STORYBOOK_TOOLING = ("storybook", "@storybook/vue3-vite", "@storybook/addon-docs", "msw", "msw-storybook-addon", "@vitejs/plugin-vue", "vite")

    def with_dev_dependencies(self, names):
        manifest = json.loads(self.current[MANIFEST])
        manifest["devDependencies"] = {name: "1.0.0" for name in names}
        return {MANIFEST: json.dumps(manifest)}

    def test_reviewed_storybook_tooling_passes(self):
        self.assertEqual(self.errors(self.with_dev_dependencies(self.STORYBOOK_TOOLING)), [])

    def test_app_source_importing_storybook_tooling_is_still_reported(self):
        changes = self.with_dev_dependencies(self.STORYBOOK_TOOLING) | {PAGE: "import { http } from 'msw'"}
        self.assertIn("apps/web/app/pages/tasks.vue: unreviewed import: msw (+1)", self.errors(changes))

    def test_unreviewed_storybook_addon_still_needs_review(self):
        self.assertEqual(
            self.errors(self.with_dev_dependencies(["@storybook/addon-vitest"])),
            ["dependency needs review: @storybook/addon-vitest"],
        )

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

    def test_story_with_real_context_passes(self):
        self.assertEqual(story_errors(self.story_snapshot()), [])

    def test_vue_file_in_stories_fails(self):
        errors = story_errors(self.story_snapshot(**{"apps/web/stories/shared/Copy.vue": "<template><p /></template>"}))
        self.assertEqual(errors, ["apps/web/stories/shared/Copy.vue: Storybook renders real components; no .vue files in stories"])

    def test_story_importing_component_outside_components_fails(self):
        errors = story_errors(self.story_snapshot(**{STORY: self.story(target="../../app/pages/example.vue")}))
        self.assertIn(STORY + ": stories import components only from apps/web/app/components", errors)

    def test_app_importing_story_fails(self):
        errors = story_errors(self.story_snapshot(**{PAGE: "<script setup>\nimport x from '../../stories/support/context'\n</script>"}))
        self.assertEqual(errors, [PAGE + ": app code must not import Storybook files"])

    def test_story_without_context_fails(self):
        errors = story_errors(self.story_snapshot(**{STORY: self.story(context="{}")}))
        self.assertEqual(errors, [STORY + ": story needs storyContext(<file:line> or unused)"])

    def test_context_that_does_not_use_component_fails(self):
        errors = story_errors(self.story_snapshot(**{USAGE_PAGE: "<template><p /></template>"}))
        self.assertEqual(errors, [f"{STORY}: storyContext apps/web/app/pages/example.vue:2 does not point at a real usage of {COMPONENT}"])

    def test_unused_context_passes(self):
        self.assertEqual(story_errors(self.story_snapshot(**{STORY: self.story(context="storyContext('unused')")})), [])

    def test_shifted_context_line_warns_without_failing(self):
        snapshot = self.story_snapshot(**{USAGE_PAGE: "<template>\n  <p />\n  <SharedExample />\n</template>"})
        self.assertEqual(story_errors(snapshot), [])
        self.assertEqual(story_warnings(snapshot), [f"{STORY}: update storyContext apps/web/app/pages/example.vue:2; that line no longer uses the component"])

    def test_coverage_requires_a_story_when_enabled(self):
        snapshot = self.story_snapshot()
        del snapshot[STORY]
        with patch("ui_policy.STORYBOOK_COMPONENTS", (COMPONENT,)):
            self.assertEqual(story_errors(snapshot), [COMPONENT + ": component needs a story"])
            self.assertEqual(story_errors(self.story_snapshot()), [])

    def test_coverage_list_entry_must_exist(self):
        missing = APP + "components/shared/Missing.vue"
        with patch("ui_policy.STORYBOOK_COMPONENTS", (missing,)):
            self.assertEqual(story_errors(self.story_snapshot()), [missing + ": listed Storybook component does not exist"])

    def test_check_reports_story_errors(self):
        changes = {"apps/web/stories/shared/Copy.vue": "<template><p /></template>"}
        self.assertIn("apps/web/stories/shared/Copy.vue: Storybook renders real components; no .vue files in stories", self.errors(changes))

    def test_commented_out_context_does_not_count(self):
        story_source = (
            "import Example from '../../app/components/shared/Example.vue'\n"
            "import { storyContext } from '../support/context'\n"
            "export default { component: Example }\n"
            "export const InPage = { parameters: {} }\n"
            "// storyContext('apps/web/app/pages/example.vue:2')\n"
        )
        errors = story_errors(self.story_snapshot(**{STORY: story_source}))
        self.assertEqual(errors, [STORY + ": story needs storyContext(<file:line> or unused)"])


    # --- story context refresh -------------------------------------------------

    def test_a_moved_usage_is_repointed_to_its_new_line(self):
        snapshot = self.story_snapshot(**{
            USAGE_PAGE: "<template>\n  <div />\n  <div />\n  <SharedExample />\n</template>"})
        refreshed = policy.refreshed_story_context(snapshot)
        self.assertIn(USAGE_PAGE + ":4", refreshed[STORY])
        self.assertEqual(story_warnings({**snapshot, **refreshed}), [])

    def test_a_reference_already_on_its_usage_is_left_alone(self):
        self.assertEqual(policy.refreshed_story_context(self.story_snapshot()), {})

    def test_a_declaration_is_the_last_resort_not_the_target(self):
        # An import names the component too; pointing there would open the
        # wrong place and still satisfy the check.
        page = ("import SharedExample from '@/components/shared/Example.vue'\n"
                "<template>\n  <SharedExample />\n</template>")
        refreshed = policy.refreshed_story_context(self.story_snapshot(**{USAGE_PAGE: page}))
        self.assertIn(USAGE_PAGE + ":3", refreshed[STORY])

    def test_a_deleted_usage_is_a_finding_not_a_line_to_move(self):
        gone = self.story_snapshot(**{USAGE_PAGE: "<template>\n  <div />\n</template>"})
        self.assertEqual(policy.refreshed_story_context(gone), {})
        self.assertTrue(story_errors(gone))


class StaticGateTest(unittest.TestCase):
    """Each gate must fire on a real violation and stay silent on clean source.

    A gate that only ever returns [] passes every run and guards nothing, so
    every rule here is asserted in both directions.
    """

    COMPONENTS = APP + "components/"
    PAGES = APP + "pages/"
    LOCALES = "apps/web/i18n/locales/"
    HR_COMPONENT = COMPONENTS + "hr/DirectoryTable.vue"

    def whole(self, **files):
        """A snapshot the completeness rules accept, with the required content."""
        snapshot = {
            APP + "app.vue": "<template><NuxtPage /></template>",
            UI + "app.config.ts": "export default defineAppConfig({\n  ui: {\n"
                                   "    colors: { primary: 'brand', neutral: 'slate' },\n  },\n})",
            UI + "assets/css/tokens.css": ":root { --color-brand-500: #06c; --ui-radius: 0.285714rem;\n"
                                           "  --nasq-midnight: #13234a; --nasq-lime: #c8f031;\n"
                                           "  --status-success: green; --status-warning: amber; --status-info: blue;\n"
                                           "  --status-danger: red; --status-danger-foreground: white;\n"
                                           "  --unread-count-foreground: white;\n"
                                           "  font-family: 'IBM Plex Sans Arabic'; }\n"
                                           "\n.dark { color: #fff; }",
            UI + "assets/css/components.css": ".nasq-status-text-warning { color: var(--status-warning); }\n"
                                               ".nasq-unread-count { color: var(--unread-count-foreground); }",
            UI + "assets/css/shell.css": ".nasq-page-width-list { max-width: none; }\n"
                                          ".nasq-page-width-detail { max-width: 68rem; }\n"
                                          ".nasq-page-width-form { max-width: 58rem; }",
        }
        snapshot.update(files)
        return snapshot

    def test_cream_mode_is_retired(self):
        snapshot = self.whole(**{UI + "assets/css/tokens.css": self.whole()[UI + "assets/css/tokens.css"] + "\n:root.cream { color: #000; }"})
        self.assertIn(UI + "assets/css/tokens.css: retired token :root.cream", policy.theme_errors(snapshot))

    # --- auto-import namespace -------------------------------------------------

    def test_auto_import_name_with_two_owners_is_reported(self):
        clash = policy.auto_import_errors({
            APP + "composables/useThing.ts": "export function useThing() {}",
            APP + "utils/thing.ts": "export const useThing = 1",
        })
        self.assertEqual(len(clash), 1)
        self.assertIn("useThing", clash[0])
        self.assertEqual(policy.auto_import_errors({
            APP + "composables/useThing.ts": "export function useThing() {}",
            APP + "utils/thing.ts": "export const other = 1",
        }), [])

    def test_renamed_export_publishes_the_new_name_only(self):
        # `export { a as b }` publishes b, so b is what may collide.
        self.assertEqual(
            policy.exported_names("const a = 1\nexport { a as useThing }\n"), ["useThing"])

    def test_component_name_claimed_twice_is_reported(self):
        collision = policy.auto_import_errors({
            self.COMPONENTS + "task/Card.vue": "", self.COMPONENTS + "task/card.ts": ""})
        self.assertEqual(len(collision), 1)
        self.assertIn("task-card", collision[0])

    def test_prefixed_component_folders_use_their_nuxt_names(self):
        # nuxt.config.ts registers pmo/tasks with prefix Task: pmo/tasks/Card.vue is TaskCard.
        collision = policy.auto_import_errors({
            self.COMPONENTS + "pmo/tasks/Card.vue": "", self.COMPONENTS + "task/card.ts": ""})
        self.assertEqual(len(collision), 1)
        self.assertIn("task-card", collision[0])
        self.assertIn("TaskCard", policy.component_names(self.COMPONENTS + "pmo/tasks/Card.vue"))

    # --- business overlays -----------------------------------------------------

    def test_overlay_tag_and_native_popup_are_reported(self):
        self.assertTrue(policy.overlay_errors({self.PAGES + "x.vue": "<template><Dialog /></template>"}))
        self.assertTrue(policy.overlay_errors({self.COMPONENTS + "x.vue": 'if (confirm("sure")) {}'}))

    def test_header_search_keeps_its_approved_dialog(self):
        search = self.COMPONENTS + "shell/GlobalSearch.vue"
        self.assertEqual(policy.overlay_errors({search: "<template><Dialog /></template>"}), [])

    def test_command_palette_and_define_shortcuts_have_one_owner(self):
        palette = "<template><UCommandPalette :groups='g' /></template>"
        self.assertEqual(policy.keyboard_layer_errors({self.COMPONENTS + "shell/GlobalSearch.vue": palette}), [])
        self.assertTrue(policy.keyboard_layer_errors({self.PAGES + "x.vue": palette}))
        for tag in ("UDashboardSearch", "u-dashboard-search", "UContentSearch", "u-content-search",
                    "LazyUCommandPalette", "lazy-u-command-palette", "LazyUDashboardSearch", "lazy-u-content-search"):
            other = f"<template><{tag} :groups='g' /></template>"
            self.assertTrue(policy.keyboard_layer_errors({self.PAGES + "x.vue": other}), tag)
            self.assertEqual(policy.keyboard_layer_errors({self.COMPONENTS + "shell/GlobalSearch.vue": other}), [], tag)
        self.assertTrue(policy.keyboard_layer_errors({self.COMPONENTS + "x.vue": "defineShortcuts({ g: () => {} })"}))
        self.assertEqual(policy.keyboard_layer_errors({self.COMPONENTS + "x.vue": "/* defineShortcuts(x) */"}), [])

    def test_overlay_named_in_a_comment_is_not_a_finding(self):
        self.assertEqual(policy.overlay_errors({
            self.PAGES + "x.vue": "<!-- the <Dialog> this replaced --><template><div /></template>"}), [])

    def test_a_confirm_handler_is_not_a_native_popup(self):
        self.assertEqual(policy.overlay_errors({
            self.COMPONENTS + "x.vue": '<SharedInlineConfirm @confirm="confirmDelete(id)" />'}), [])

    # --- theme and recipes -----------------------------------------------------

    def test_custom_recipe_class_is_reported_and_z_tokens_are_not(self):
        self.assertTrue(policy.recipe_errors({self.COMPONENTS + "x.vue": '<div class="nasq-ui-panel" />'}))
        self.assertEqual(policy.recipe_errors({self.COMPONENTS + "x.vue": '<div class="nasq-ui-z-40" />'}), [])

    def test_theme_colors_and_undocumented_recipe_key_are_reported(self):
        config = UI + "app.config.ts"
        moved = self.whole(**{config: "  ui: {\n    colors: { primary: 'sky', neutral: 'slate' },\n  }"})
        self.assertTrue(any("theme colors" in error for error in policy.theme_errors(moved)))
        added = self.whole(**{config: self.whole()[config].replace("  },", "    carousel: {},\n  },")})
        self.assertTrue(any("carousel" in error for error in policy.theme_errors(added)))

    def test_theme_probes_tolerate_reformatting(self):
        spaced = self.whole(**{UI + "app.config.ts":
                               "  ui: {\n    colors: {   primary: 'brand',\n      neutral: 'slate' },\n  }"})
        self.assertEqual([e for e in policy.theme_errors(spaced) if "theme colors" in e], [])

    def test_retired_theme_token_is_reported(self):
        snapshot = self.whole()
        snapshot[UI + "assets/css/tokens.css"] += "\n--elevation-1: 0 1px 2px #0001;"
        self.assertTrue(any("--elevation-1" in error for error in policy.theme_errors(snapshot)))

    # --- page shell ------------------------------------------------------------

    def test_page_without_an_approved_shell_is_reported(self):
        bare = self.whole(**{self.PAGES + "probe.vue": "<template><div /></template>"})
        self.assertTrue(any("approved shells" in error for error in policy.page_shell_errors(bare)))
        shelled = self.whole(**{self.PAGES + "probe.vue": '<SharedPageContainer width="list" />'})
        self.assertEqual([e for e in policy.page_shell_errors(shelled) if "approved shells" in e], [])

    def test_template_pages_count_as_approved_shells(self):
        for tag in ('SharedListPage', 'SharedRecordPage', 'SharedDashboardPage', 'SharedTimelineFrame',
                    'SharedConversationLayout', 'SharedStandalonePage'):
            page = self.whole(**{self.PAGES + "probe.vue": f'<{tag} title="x" />'})
            self.assertEqual([e for e in policy.page_shell_errors(page) if "approved shells" in e], [], tag)

    def test_route_parent_exemption_holds(self):
        parent = self.whole(**{self.PAGES + "projects.vue": "<template><NuxtPage /></template>"})
        self.assertEqual([e for e in policy.page_shell_errors(parent) if "approved shells" in e], [])

    def test_ad_hoc_page_width_is_reported(self):
        wide = {self.PAGES + "probe.vue": '<div class="mx-auto max-w-5xl">'}
        self.assertTrue(any("max-width" in error for error in policy.page_shell_errors(wide)))

    def test_page_width_probe_tolerates_minified_css(self):
        minified = self.whole()
        minified[UI + "assets/css/shell.css"] = (".nasq-page-width-list{max-width:none}"
                                                  ".nasq-page-width-detail{max-width:68rem}"
                                                  ".nasq-page-width-form{max-width:58rem}")
        self.assertEqual([e for e in policy.page_shell_errors(minified) if "page width" in e], [])

    def test_completeness_rules_say_nothing_about_a_partial_snapshot(self):
        # The caller passed one file; reporting every missing token would be noise.
        partial = {self.PAGES + "probe.vue": "<template><div /></template>"}
        self.assertFalse(policy.whole_tree(partial))
        self.assertEqual(policy.page_shell_errors(partial), [])
        self.assertEqual(policy.theme_errors(partial), [])

    # --- credentials -----------------------------------------------------------

    def test_rendered_credential_and_credential_in_url_are_reported(self):
        self.assertTrue(policy.secret_render_errors({self.COMPONENTS + "x.vue": "{{ user.password }}"}))
        self.assertTrue(policy.secret_render_errors({
            self.COMPONENTS + "x.ts": "useApi()('/api/v1/admin/users?password=' + value)"}))

    def test_an_unrelated_identifier_is_not_a_credential(self):
        self.assertEqual(policy.secret_render_errors({self.COMPONENTS + "x.vue": "{{ user.name }}"}), [])

    # --- shell, styles, button ranks ------------------------------------------

    def test_breadcrumb_is_owned_by_the_shell(self):
        owner = APP + 'components/shell/ShellBreadcrumb.vue'
        page = APP + 'pages/tasks.vue'
        trail = '<template><UBreadcrumb :items="items" /></template>'
        self.assertEqual(policy.breadcrumb_errors({owner: trail}), [])
        self.assertEqual(policy.breadcrumb_errors({page: trail}),
                         [page + ': the breadcrumb belongs to shell/ShellBreadcrumb.vue (DESIGN.md)'])
        self.assertEqual(policy.breadcrumb_errors({page: '<!-- <UBreadcrumb /> -->'}), [])

    def test_breadcrumb_check_covers_the_shell_component_and_kebab_tags(self):
        header = APP + 'components/shell/ShellHeader.vue'
        page = APP + 'pages/tasks.vue'
        self.assertEqual(policy.breadcrumb_errors({header: '<template><ShellBreadcrumb :items="items" /></template>'}), [])
        for tag in ('<ShellBreadcrumb />', '<shell-breadcrumb />', '<u-breadcrumb />', '<ubreadcrumb />'):
            self.assertEqual(policy.breadcrumb_errors({page: '<template>' + tag + '</template>'}),
                             [page + ': the breadcrumb belongs to shell/ShellBreadcrumb.vue (DESIGN.md)'], tag)

    def test_the_header_may_mount_only_shell_breadcrumb(self):
        header = APP + 'components/shell/ShellHeader.vue'
        for tag in ('<UBreadcrumb :items="items" />', '<u-breadcrumb />', '<ubreadcrumb />'):
            self.assertEqual(policy.breadcrumb_errors({header: '<template>' + tag + '</template>'}),
                             [header + ': the breadcrumb belongs to shell/ShellBreadcrumb.vue (DESIGN.md)'], tag)

    def test_component_styles_have_no_remaining_private_owner(self):
        self.assertTrue(policy.scoped_style_errors({self.COMPONENTS + "task/New.vue": "<style scoped>.a{}</style>"}))
        owner = self.COMPONENTS + "shared/form/RichText.vue"
        self.assertEqual(policy.STYLE_OWNERS, frozenset())
        self.assertTrue(policy.scoped_style_errors({owner: "<style scoped>.a{}</style>"}))

    def test_filled_secondary_button_is_reported_and_quiet_variants_are_not(self):
        self.assertTrue(policy.button_rank_errors({
            self.COMPONENTS + "x.vue": '<UButton color="secondary">Go</UButton>'}))
        for variant in ("outline", "ghost", "soft", "subtle", "link"):
            self.assertEqual(policy.button_rank_errors({
                self.COMPONENTS + "x.vue": f'<UButton color="secondary" variant="{variant}">Go</UButton>'}), [])

    def test_retired_route_sheet_file_and_artifact_are_reported(self):
        self.assertTrue(policy.retired_artifact_errors({policy.RETIRED_FILES[0]: "<template><div /></template>"}))
        self.assertTrue(policy.retired_artifact_errors({
            UI + "assets/css/components.css": ".nasq-sheet-in { opacity: 0; }"}))

    # --- HR boundary -----------------------------------------------------------

    def test_hr_role_branch_and_legacy_access_composable_are_reported(self):
        self.assertTrue(policy.hr_boundary_errors({self.HR_COMPONENT: "if (me.value?.role === 'hr') {}"}))
        self.assertTrue(policy.hr_boundary_errors({
            APP + "composables/useHrEmployees.ts": "export function useGrantHrAccess() {}"}))
        self.assertEqual(policy.hr_boundary_errors({self.HR_COMPONENT: "can('hr.employees.manage')"}), [])

    # --- locale parity ---------------------------------------------------------

    def test_locale_key_missing_from_one_catalogue_is_reported(self):
        gap = policy.locale_parity_errors({
            self.LOCALES + "hr.json": "{}",  # not under a locale directory; ignored
            self.LOCALES + "ar/hr.json": '{"a": {"b": "x"}}',
            self.LOCALES + "en/hr.json": '{"a": {}}',
        })
        self.assertEqual(gap, [self.LOCALES + "en/hr.json: missing key a.b"])

    def test_arabic_plural_categories_are_one_key_not_six(self):
        # Arabic declines six categories where English has two.
        self.assertEqual(policy.locale_parity_errors({
            self.LOCALES + "ar/x.json": '{"n": {"one": "1", "two": "2", "few": "3", "many": "4", "other": "n"}}',
            self.LOCALES + "en/x.json": '{"n": {"one": "1", "other": "n"}}',
        }), [])

    def test_a_catalogue_without_a_counterpart_is_reported(self):
        self.assertTrue(policy.locale_parity_errors({self.LOCALES + "ar/only.json": '{"a": 1}'}))

    def test_invalid_locale_json_is_reported_rather_than_raised(self):
        errors = policy.locale_parity_errors({self.LOCALES + "ar/x.json": "{",
                                              self.LOCALES + "en/x.json": "{}"})
        self.assertTrue(any("invalid JSON" in error for error in errors))

    # --- physical CSS ----------------------------------------------------------

    def test_physical_edges_are_reported_and_logical_ones_are_not(self):
        for markup in ('<div class="ml-2" />', '<div class="pr-4" />', '<div class="left-0" />',
                       '<div class="text-right" />', '<div class="ltr:ml-2" />'):
            self.assertTrue(policy.retired_pattern_errors({self.COMPONENTS + "x.vue": markup}), markup)
        for markup in ('<div class="ms-2 pe-4 start-0 text-start" />', '<div class="rtl:rotate-180" />',
                       '<div class="border-r" />', '<div class="rounded-l-md" />'):
            self.assertEqual(policy.retired_pattern_errors({self.COMPONENTS + "x.vue": markup}), [], markup)


    # --- list toolbar ----------------------------------------------------------

    def test_hand_rolled_page_search_is_reported(self):
        rolled = self.whole(**{self.PAGES + "probe.vue":
                               '<SharedPageContainer><UInput icon="i-lucide-search" /></SharedPageContainer>'})
        self.assertTrue(any("FilterBar" in error for error in policy.toolbar_errors(rolled)))
        shared = self.whole(**{self.PAGES + "probe.vue":
                               '<FilterBar :active-count="n"><template #search>'
                               '<UInput icon="i-lucide-search" /></template></FilterBar>'})
        self.assertEqual(policy.toolbar_errors(shared), [])

    def test_the_search_page_itself_is_exempt(self):
        search = self.whole(**{self.PAGES + "search.vue": '<UInput icon="i-lucide-search" />'})
        self.assertEqual(policy.toolbar_errors(search), [])

    # --- templates and merges (Tasmim Plan 4) ----------------------------------

    def test_a_per_app_badge_is_reported_and_the_shared_one_is_not(self):
        for path in ("task/StateBadge.vue", "project/ProjectStatusBadge.vue", "vendor/OrderStateBadge.vue",
                     "access/AccessStateBadge.vue", "meetings/StatusBadge.vue", "task/DeadlineBadge.vue",
                     "plan/LifecycleBadge.vue"):
            errors = policy.template_errors({self.COMPONENTS + path: "<template><UBadge /></template>"})
            self.assertTrue(any("StatusBadge" in error for error in errors), path)
        self.assertEqual(policy.template_errors({
            policy.STATUS_BADGE_OWNER: "<template><UBadge /></template>",
            self.COMPONENTS + "task/taskStateTone.ts": "export const TONES = {}",
        }), [])

    def test_filter_card_file_and_tag_are_reported(self):
        self.assertTrue(policy.template_errors({policy.FILTER_CARD_FILE: "<template><div /></template>"}))
        for markup in ("<FilterCard />", "<SharedFilterCard :active-count='1' />", "<shared-filter-card />",
                       "<LazySharedFilterCard />"):
            self.assertTrue(policy.template_errors({self.PAGES + "x.vue": f"<template>{markup}</template>"}), markup)
        for markup in ("<SharedFilterBar /><!-- FilterCard folded in here -->",
                       "<SharedFilterBar :content-id=\"'filter-card-' + id\" />"):
            self.assertEqual(policy.template_errors({self.PAGES + "x.vue": f"<template>{markup}</template>"}), [], markup)

    def test_every_contract_template_must_be_listed_in_storybook(self):
        whole = self.whole()
        missing = policy.CONTRACT_TEMPLATES[0]
        with patch("ui_policy.STORYBOOK_COMPONENTS", policy.CONTRACT_TEMPLATES[1:]):
            self.assertEqual(policy.template_errors(whole),
                             [missing + ": contract template must be listed in STORYBOOK_COMPONENTS"])
        with patch("ui_policy.STORYBOOK_COMPONENTS", policy.CONTRACT_TEMPLATES):
            self.assertEqual(policy.template_errors(whole), [])
        # A partial snapshot says nothing about the list.
        with patch("ui_policy.STORYBOOK_COMPONENTS", ()):
            self.assertEqual(policy.template_errors({self.PAGES + "x.vue": "<template />"}), [])

    def test_the_real_list_names_every_contract_template(self):
        self.assertEqual([path for path in policy.CONTRACT_TEMPLATES if path not in policy.STORYBOOK_COMPONENTS], [])

if __name__ == '__main__':
    unittest.main()

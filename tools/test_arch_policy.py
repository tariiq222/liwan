# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from arch_policy import (
    app_token,
    collect,
    commit_parents,
    compare,
    core_depends_violations,
    count,
    file_at,
    foreign_component_uses,
    is_test_path,
    layer_violations,
    layer_weakenings,
    layers_weakened,
    main,
    odoo_access_overrides,
    ratchet_problems,
    routes_without_feature,
    rule_totals,
    sql_on_odoo_tables,
    sudo_calls,
    ui_layer_violations,
    vendor_admin_imported,
    vendor_admin_violations,
    unregistered_addons,
)

RANKS = {'webvue_core': 0, 'webvue_platform': 1, 'webvue_api': 2, 'webvue_pmo': 4, 'webvue_hr': 4, 'webvue_meetings_pmo': 5}
WEB_APPS = {
    'pmo': {'components': ['project', 'task'], 'pages': ['projects', 'tasks']},
    'meetings': {'components': ['meetings'], 'pages': ['meetings']},
    'hr': {'components': ['hr'], 'pages': ['hr']},
    'chat': {'components': ['chat'], 'pages': ['chat']},
}
COMMERCIAL = {
    'pages': {'subscription': 'customer-commercial'},
    'allowed': ['apps/web/app/pages/subscription/', 'apps/web/server/'],
}
HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.\n'


class TestPureRules(unittest.TestCase):
    def test_core_may_depend_on_base_only(self):
        self.assertEqual(core_depends_violations(['base']), {})
        self.assertEqual(
            core_depends_violations(['base', 'project', 'hr']),
            {'webvue_core depends on project': 1, 'webvue_core depends on hr': 1},
        )

    def test_dependencies_must_point_strictly_down(self):
        self.assertEqual(layer_violations('webvue_pmo', ['webvue_api', 'project', 'webvue_pmo'], RANKS, 'depends on'), {})
        self.assertEqual(
            layer_violations('webvue_pmo', ['webvue_hr'], RANKS, 'imports'),
            {'webvue_pmo imports webvue_hr': 1},
        )
        self.assertEqual(
            layer_violations('webvue_core', ['webvue_platform', 'webvue_platform'], RANKS, 'imports'),
            {'webvue_core imports webvue_platform': 2},
        )
        self.assertEqual(layer_violations('webvue_meetings_pmo', ['webvue_pmo', 'webvue_api'], RANKS, 'depends on'), {})

    def test_unregistered_addons_are_listed(self):
        self.assertEqual(
            unregistered_addons(['webvue_core', 'webvue_sales', 'web_theme_shadcn'], RANKS, ['web_theme_shadcn']),
            ['webvue_sales'],
        )

    def test_sql_counts_only_non_webvue_tables(self):
        text = (
            "cr.execute('SELECT 1 FROM hr_employee e JOIN webvue_access_role r ON 1=1; UPDATE res_users SET x=1')\n"
        )
        self.assertEqual(sql_on_odoo_tables(text), 2)

    def test_sql_counts_lowercase_quoted_fstring_and_sql_wrapper(self):
        self.assertEqual(sql_on_odoo_tables("self.env.cr.execute('select id from hr_employee')"), 1)
        self.assertEqual(sql_on_odoo_tables("cr.execute('SELECT 1 FROM \"res_users\"')"), 1)
        self.assertEqual(sql_on_odoo_tables("cr.execute(f'SELECT 1 FROM res_partner WHERE id = {x}')"), 1)
        self.assertEqual(sql_on_odoo_tables("q = SQL('delete from project_task WHERE id = %s', 1)"), 1)
        self.assertEqual(sql_on_odoo_tables("q = odoo.tools.SQL('INSERT INTO mail_message (a) VALUES (1)')"), 1)
        self.assertEqual(sql_on_odoo_tables("cr.execute('SELECT 1 FROM webvue_access_role')"), 0)

    def test_for_update_of_is_not_a_table(self):
        self.assertEqual(sql_on_odoo_tables("cr.execute('SELECT 1 FROM res_users u FOR UPDATE OF u')"), 1)

    def test_sql_keywords_are_not_tables(self):
        for sql in (
            "INSERT INTO webvue_x (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 1",
            "SELECT 1 FROM webvue_x a JOIN LATERAL (SELECT 1) l ON TRUE",
            "SELECT EXTRACT(EPOCH FROM created_at) FROM webvue_x",
            "SELECT 1 FROM webvue_x WHERE a IS DISTINCT FROM b",
            "SELECT 1 FROM webvue_x WHERE a IS NOT DISTINCT FROM b",
            "SELECT SUBSTRING(x FROM 2) FROM webvue_x",
            "SELECT TRIM(BOTH ' ' FROM x) FROM webvue_x",
            "SELECT 1 FROM webvue_x FOR UPDATE OF u",
            "SELECT 1 FROM UNNEST(ids) i JOIN GENERATE_SERIES(1, 2) g ON TRUE JOIN webvue_x ON TRUE",
        ):
            with self.subTest(sql=sql):
                self.assertEqual(sql_on_odoo_tables(f"cr.execute({sql!r})"), 0)

    def test_from_only_still_captures_the_table(self):
        self.assertEqual(sql_on_odoo_tables("cr.execute('SELECT 1 FROM ONLY res_users')"), 1)
        self.assertEqual(sql_on_odoo_tables("cr.execute('select id from res_users')"), 1)

    def test_each_sql_string_counts_once(self):
        self.assertEqual(sql_on_odoo_tables("cr.execute(SQL('select id from res_users'))"), 1)
        self.assertEqual(sql_on_odoo_tables("q = SQL('SELECT 1 FROM res_users')"), 1)
        self.assertEqual(sql_on_odoo_tables("cr.execute('SELECT 1 FROM res_users')"), 1)

    def test_sql_through_a_local_variable_is_counted(self):
        text = "def f(self):\n    query = 'SELECT id FROM res_users'\n    self.env.cr.execute(query)\n"
        self.assertEqual(sql_on_odoo_tables(text), 1)
        ann = "def f(self):\n    query: str = 'SELECT id FROM res_users'\n    self.env.cr.execute(query)\n"
        self.assertEqual(sql_on_odoo_tables(ann), 1)
        fstr = "def f(self, w):\n    query = f'SELECT id FROM res_users WHERE {w}'\n    self.env.cr.execute(query)\n"
        self.assertEqual(sql_on_odoo_tables(fstr), 1)

    def test_augmented_assignment_adds_its_table(self):
        text = (
            "def f(self):\n    query = 'SELECT 1 FROM webvue_x'\n    query += ' JOIN res_users u ON 1=1'\n"
            "    self.env.cr.execute(query)\n"
        )
        self.assertEqual(sql_on_odoo_tables(text), 1)

    def test_same_named_variable_in_another_function_is_not_counted(self):
        text = (
            "def a(self):\n    query = 'SELECT 1 FROM res_users'\n    return query\n"
            "def b(self):\n    query = 'SELECT 1 FROM webvue_x'\n    self.env.cr.execute(query)\n"
        )
        self.assertEqual(sql_on_odoo_tables(text), 0)

    def test_variable_passed_twice_or_to_two_executes_counts_once(self):
        twice = "def f(self):\n    q = 'SELECT 1 FROM res_users'\n    self.env.cr.execute(q, (q,))\n"
        self.assertEqual(sql_on_odoo_tables(twice), 1)
        two = "def f(self):\n    q = 'SELECT 1 FROM res_users'\n    cr.execute(q)\n    cr.execute(q)\n"
        self.assertEqual(sql_on_odoo_tables(two), 1)

    def test_variable_holding_sql_wrapper_counts_once(self):
        text = "def f(self):\n    query = 'SELECT 1 FROM res_users'\n    self.env.cr.execute(SQL(query))\n"
        self.assertEqual(sql_on_odoo_tables(text), 1)
        wrapped = "def f(self):\n    q = SQL('SELECT 1 FROM res_users')\n    self.env.cr.execute(q)\n"
        self.assertEqual(sql_on_odoo_tables(wrapped), 1)

    def test_module_level_variable_is_counted_for_module_level_calls(self):
        text = "QUERY = 'SELECT 1 FROM res_users'\ncr.execute(QUERY)\n"
        self.assertEqual(sql_on_odoo_tables(text), 1)

    def test_sql_ignores_prose_and_unrelated_calls(self):
        text = "def f():\n    \"\"\"returns rows from the cache\"\"\"\n    # select x from y\n    log('update res_users')\n"
        self.assertEqual(sql_on_odoo_tables(text), 0)

    def test_access_overrides_count_only_on_odoo_models(self):
        override = '    def _search(self, domain):\n        pass\n    def check_access(self, operation):\n        pass\n'
        self.assertEqual(odoo_access_overrides("    _inherit = 'hr.employee'\n" + override), 2)
        self.assertEqual(odoo_access_overrides("    _inherit = 'webvue.access.role'\n" + override), 0)
        self.assertEqual(odoo_access_overrides("    _name = 'webvue.thing'\n" + override), 0)

    def test_sudo_counts_calls_not_comments_or_strings(self):
        text = "# x.sudo() in a comment\nA = 'y.sudo()'\nb = env['res.users'].sudo().browse(1).sudo()\n"
        self.assertEqual(sudo_calls(text), 2)

    def test_su_true_and_superuser_id_are_counted(self):
        self.assertEqual(sudo_calls("env = request.env(su=True)\nother = self.env(su=True, lang='ar')\n"), 2)
        self.assertEqual(sudo_calls("env = request.env(su=False)\n"), 0)
        self.assertEqual(sudo_calls("from odoo import SUPERUSER_ID\nenv = api.Environment(cr, SUPERUSER_ID, {})\n"), 1)
        self.assertEqual(sudo_calls("from odoo import SUPERUSER_ID\n"), 0)

    def test_superuser_id_counting_does_not_depend_on_an_import(self):
        # The removed `imported` set could never hold a name: an ast.ImportFrom subtree carries ast.alias
        # nodes, never ast.Name, so the exclusion was dead and the counting below is the intended one.
        self.assertEqual(sudo_calls("def f():\n    from odoo import SUPERUSER_ID\n    return api.Environment(cr, SUPERUSER_ID, {})\n"), 1)
        self.assertEqual(sudo_calls("from odoo import SUPERUSER_ID as UID\nA = SUPERUSER_ID\n"), 1)
        self.assertEqual(sudo_calls("A = SUPERUSER_ID\nB = SUPERUSER_ID + 1\n"), 2)
        self.assertEqual(sudo_calls("A = SUPERUSER_ID\n", superuser_id=False), 0)
        self.assertEqual(sudo_calls("A = SUPERUSER_ID\n", superuser_id=True), 1)

    def test_routes_need_requires_feature(self):
        text = (
            "class C:\n"
            "    @http.route('/api/v1/a', type='json2')\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled', operation='read')\n"
            "    def covered(self):\n        pass\n"
            "    @http.route('/api/v1/b', type='json2')\n"
            "    @api_handler\n"
            "    def bare(self):\n        pass\n"
            "    def helper(self):\n        pass\n"
        )
        self.assertEqual(routes_without_feature(text), ['bare'])

    def test_foreign_components_are_counted_by_tag_and_import(self):
        text = "<HrEmployeeCard /><TaskRow /><Hrx />\nimport X from '~/components/hr/EmployeeCard.vue'"
        self.assertEqual(foreign_component_uses(text, 'pmo', WEB_APPS), 2)
        self.assertEqual(foreign_component_uses(text, 'hr', WEB_APPS), 1)

    def test_relative_cross_app_module_import_is_flagged(self):
        rel = 'apps/web/app/modules/pmo/manifest.ts'
        for spec in ("import { m } from '../hr/manifest'", "export * from '../hr/manifest'",
                     "const m = await import('../hr/manifest')", "import '../hr/manifest'",
                     "import { m } from '~/modules/hr/manifest'"):
            self.assertEqual(foreign_component_uses(spec, 'pmo', WEB_APPS, rel), 1, spec)

    def test_module_mentions_in_comments_are_not_flagged(self):
        rel = 'apps/web/app/modules/pmo/manifest.ts'
        text = "// see modules/hr/manifest\n/* import x from '../hr/manifest' */\nconst u = 'http://a'; // ../hr/x\n"
        self.assertEqual(foreign_component_uses(text, 'pmo', WEB_APPS, rel), 0)

    def test_own_folder_imports_are_allowed(self):
        rel = 'apps/web/app/modules/pmo/manifest.ts'
        text = "import { a } from './helpers'\nimport { b } from '../pmo/other'\nimport { c } from '../registry'"
        self.assertEqual(foreign_component_uses(text, 'pmo', WEB_APPS, rel), 0)

    def test_glob_strings_are_not_import_specifiers(self):
        rel = 'apps/web/app/modules/registry.ts'
        text = "const all = import.meta.glob('./hr/manifest.ts')"
        self.assertEqual(foreign_component_uses(text, 'pmo', WEB_APPS, rel), 0)

    def test_test_paths_are_recognised(self):
        self.assertTrue(is_test_path(Path('odoo-addons/webvue_pmo/tests/test_tasks.py')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/__tests__/a.ts')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/a.test.ts')))
        self.assertFalse(is_test_path(Path('odoo-addons/webvue_pmo/models/project_task.py')))

    def test_every_app_folder_is_caught_in_every_tag_form(self):
        for directory, name in (('project', 'Project'), ('task', 'Task'), ('meetings', 'Meetings'),
                                ('hr', 'Hr'), ('chat', 'Chat')):
            for tag in (f'<{name}Card />', f'<Lazy{name}Card />', f'<{directory}-card />', f'<lazy-{directory}-card />'):
                with self.subTest(tag=tag):
                    self.assertEqual(foreign_component_uses(tag, '', WEB_APPS), 1)

    def test_declared_tag_prefixes_catch_renamed_component_folders(self):
        # components/pmo/{projects,tasks} keep the Project*/Task* names, so the folder name is no clue.
        apps = {
            'pmo': {'components': ['pmo'], 'pages': ['projects'], 'tags': ['Project', 'Task']},
            'tasks': {'components': ['personal-tasks'], 'pages': ['my-tasks'], 'tags': ['MyTasks']},
            'hr': {'components': ['hr'], 'pages': ['hr']},
        }
        for tag in ('<ProjectTable />', '<LazyTaskRow />', '<project-table />', '<MyTasksList />', '<my-tasks-list />'):
            with self.subTest(tag=tag):
                self.assertEqual(foreign_component_uses(tag, 'hr', apps), 1)
        self.assertEqual(foreign_component_uses('<ProjectTable /><TaskRow />', 'pmo', apps), 0)
        self.assertEqual(foreign_component_uses('<PmoCard /><PersonalTasksList />', 'hr', apps), 0)
        self.assertEqual(foreign_component_uses('<HrCard />', 'pmo', apps), 1)

    def test_html_and_own_tags_are_not_foreign(self):
        self.assertEqual(foreign_component_uses('<hr /><hr><Hrx />', '', WEB_APPS), 0)
        self.assertEqual(foreign_component_uses('<LazyChatPanel /><chat-panel />', 'chat', WEB_APPS), 0)

    def test_losing_a_declared_web_app_tag_is_a_weakening(self):
        # A `tags` list is what R3 matches component names against, so dropping one hides foreign uses.
        old = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects'], 'tags': ['Project', 'Task']}}}
        kept = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects'], 'tags': ['Project']}}}
        grown = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects'],
                                      'tags': ['Project', 'Task', 'Milestone']}}}
        self.assertEqual(layers_weakened(old, kept, Path('/nonexistent-arch-root')), ['web app tag Task removed from pmo'])
        self.assertEqual(layers_weakened(old, grown, Path('/nonexistent-arch-root')), [])
        self.assertEqual(layers_weakened(old, old, Path('/nonexistent-arch-root')), [])

    def test_a_tag_the_components_folders_derive_is_not_a_weakening(self):
        # tag_prefixes() derives Project from components/project, so a `tags` entry that only repeats it is
        # redundant and removing it loses nothing; Task has no component folder behind it and is a real loss.
        derived = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects']}}}
        redundant = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects'], 'tags': ['Project']}}}
        declared = {'web_apps': {'pmo': {'components': ['project'], 'pages': ['projects'],
                                         'tags': ['Project', 'Task']}}}
        self.assertEqual(layers_weakened(redundant, derived, Path('/nonexistent-arch-root')), [])
        self.assertEqual(
            layers_weakened(declared, derived, Path('/nonexistent-arch-root')),
            ['web app tag Task removed from pmo'],
        )


class TestAppToken(unittest.TestCase):
    RANKS = {
        'webvue_core': 0, 'webvue_platform': 1, 'webvue_api': 2, 'webvue_notify': 3,
        'webvue_pmo': 4, 'webvue_sales': 4, 'webvue_meetings_pmo': 5, 'customer_acme_sales': 6,
    }

    def test_a_registered_application_contributes_its_key_prefix_and_its_xml_ids(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "k = 'sales.orders.read'"), 1)
        self.assertEqual(count(token, "g = env.ref('webvue_sales.group_x')"), 1)
        self.assertEqual(count(token, "from odoo.addons.webvue_sales.models import x"), 1)

    def test_a_bridge_token_counts_once(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "r = 'webvue_meetings_pmo.rule_x'"), 1)
        self.assertEqual(count(token, "k = 'meetings_pmo.thing'"), 1)

    def test_odoo_models_stay_tokens(self):
        token = app_token({'webvue_core': 0})
        self.assertEqual(count(token, "m = 'project.task'; e = 'hr.employee'"), 1)
        self.assertEqual(count(token, "a = 'pmo.tasks.read'; b = 'meetings.read'; d = 'chat.title'"), 0)

    def test_shipped_application_prefixes_come_from_the_registered_ranks(self):
        shipped = {'webvue_core': 0, 'webvue_hr': 4, 'webvue_pmo': 4, 'webvue_meetings': 4, 'webvue_chat': 4}
        token = app_token(shipped)
        self.assertEqual(count(token, "m = 'project.task'; e = 'hr.employee'"), 2)
        self.assertEqual(count(token, "a = 'pmo.tasks.read'; b = 'meetings.read'; d = 'chat.title'"), 3)

    def test_unregistered_names_shared_services_and_overlays_are_not_tokens(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "a = 'crm.leads.read'; b = 'webvue_crm.group_x'"), 0)
        self.assertEqual(count(token, "a = 'notify.kind'; b = 'webvue_notify.x'; c = 'api.v1'"), 0)
        self.assertEqual(count(token, "a = 'customer_acme_sales.x'; b = 'acme_sales.y'"), 0)
        self.assertEqual(count(token, "a = 'presales.x'"), 0)


class TestCompare(unittest.TestCase):
    def test_equal_sets_pass(self):
        self.assertEqual(compare({'R7': {'a.py': 2}}, {'R7': {'a.py': 2}}), [])

    def test_increase_and_new_key_fail(self):
        self.assertEqual(
            compare({'R7': {'a.py': 3, 'b.py': 1}}, {'R7': {'a.py': 2}}),
            ['R7: a.py: 3 found, baseline allows 2', 'R7: b.py: 1 found, baseline allows 0'],
        )

    def test_stale_baseline_fails_so_it_only_shrinks(self):
        problems = compare({'R7': {}}, {'R7': {'a.py': 2}})
        self.assertEqual(len(problems), 1)
        self.assertIn('lower the baseline with --write-baseline', problems[0])

    def test_rule_missing_from_either_side(self):
        self.assertEqual(compare({}, {}), [])
        self.assertEqual(compare({'R1': {'x': 1}}, {}), ['R1: x: 1 found, baseline allows 0'])


class TestCollect(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers = {'ranks': {'webvue_core': 0, 'webvue_pmo': 4}, 'exempt': ['web_theme_shadcn'], 'web_apps': WEB_APPS,
                       'commercial': COMMERCIAL}

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def addon(self, name, depends, extra=''):
        self.write(f'odoo-addons/{name}/__manifest__.py', HEADER + repr({'name': name, 'depends': depends}) + extra)

    def clean_tree(self):
        self.addon('webvue_core', ['base'])
        self.addon('webvue_pmo', ['webvue_core', 'project'])
        self.write(
            'odoo-addons/webvue_pmo/models/feature_registry.py',
            HEADER + "X = {'key': 'pmo.enabled', 'owner': 'webvue_pmo'}\n",
        )

    def test_shell_and_layout_name_no_application(self):
        self.clean_tree()
        self.write('apps/web/app/components/shell/ContextSidebar.vue',
                   "<script setup>import L from '@/components/hr/List.vue'</script><template><TaskRow /></template>\n")
        self.write('apps/web/app/layouts/default.vue', '<template><ProjectMenu /></template>\n')
        self.write('apps/web/app/components/shell/ShellHeader.vue',
                   "<script setup>import N from '@/components/notifications/NotificationCenter.vue'</script>\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R3'], {
            'web apps/web/app/components/shell/ContextSidebar.vue': 2,
            'web apps/web/app/layouts/default.vue': 1,
        })

    def test_shell_flags_lazy_kebab_and_module_imports_of_any_app(self):
        self.clean_tree()
        self.write('apps/web/app/components/shell/ShellHeader.vue',
                   "<script setup>import m from '@/modules/chat/manifest'</script>"
                   "<template><LazyChatSidebarPanel /><meetings-card /></template>\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R3'], {'web apps/web/app/components/shell/ShellHeader.vue': 3})

    def test_shell_of_the_ui_layer_names_no_application(self):
        self.clean_tree()
        self.write('packages/ui/app/components/shell/ShellHeader.vue', '<template><TaskRow /></template>\n')
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R3'], {'web packages/ui/app/components/shell/ShellHeader.vue': 1})

    def test_ui_layer_importing_an_app_is_a_hard_failure(self):
        self.clean_tree()
        self.write('packages/ui/app/components/Bad.vue', "<script setup>import x from 'apps/web/app/x'</script>\n")
        self.write('packages/ui/app/composables/useBad.ts', "import { y } from '@/composables/y'\n")
        self.write('packages/ui/app/assets/css/bad.css', "@import '~/assets/x.css';\n")
        self.write('packages/ui/app/components/Good.vue', "<script setup>import z from './Good2.vue'</script>\n")
        self.write('packages/ui/app/components/__tests__/Bad.test.ts', "import x from 'apps/web/app/x'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual([h.split(' ')[1] for h in hard], [
            'packages/ui/app/assets/css/bad.css',
            'packages/ui/app/components/Bad.vue',
            'packages/ui/app/composables/useBad.ts',
        ])

    def test_commercial_ui_layer_importing_an_app_is_a_hard_failure(self):
        self.clean_tree()
        self.write('packages/commercial-ui/app/components/Bad.vue', "<script setup>import x from 'apps/vendor-admin/app/x'</script>\n")
        self.write('packages/commercial-ui/app/composables/useBad.ts', "import { y } from '@/composables/y'\n")
        self.write('packages/commercial-ui/app/composables/useGood.ts', "import { z } from '@webvue/commercial-contracts'\n")
        self.write('packages/commercial-ui/app/components/__tests__/Bad.test.ts', "import x from 'apps/web/app/x'\n")
        self.write('packages/commercial-ui/node_modules/dep/index.ts', "import x from 'apps/web/x'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual([h.split(' ')[1] for h in hard], [
            'packages/commercial-ui/app/components/Bad.vue',
            'packages/commercial-ui/app/composables/useBad.ts',
        ])

    def test_ui_layer_css_and_node_modules(self):
        self.clean_tree()
        self.write('packages/ui/app/assets/css/a.css', "a { background: url(../../../../apps/web/a.png) }\n")
        self.write('packages/ui/app/assets/css/b.css', "@source '../../../../../apps/web/app';\n")
        self.write('packages/ui/node_modules/dep/index.ts', "import x from 'apps/web/x'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual([h.split(' ')[1] for h in hard], ['packages/ui/app/assets/css/a.css', 'packages/ui/app/assets/css/b.css'])

    def test_clean_ui_layer_passes(self):
        self.clean_tree()
        self.write('packages/ui/app/components/Good.vue', "<script setup>import { ref } from 'vue'</script>\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])

    def test_ui_layer_patterns(self):
        for bad in ("import a from 'odoo-addons/x'", "import '@webvue/contracts'", "from '~/x'", "require('../../apps/web/x')",
                    "import c from '../../../control-plane/x'",
                    "import d from '~~/x'", "export * from '@@/x'", "const m = import('@/x')", "import.meta.glob('../../apps/web/*.ts')",
                    "import.meta.glob(['/apps/web/a.ts'])", "@source '../../apps/web/app';", "background: url(../../apps/web/a.png);",
                    "@import url('~/x.css');"):
            self.assertEqual(ui_layer_violations(bad), 1, bad)
        for good in ("import a from 'vue'", "import b from '@webvue/ui/app/x'", "import c from './apps-list'",
                    "// moved from apps/web/app/x", "/* imported from @/composables by the app */", "see apps/web/app/x for import details",
                    "background: url(./a.png);", "@source '../app';"):
            self.assertEqual(ui_layer_violations(good), 0, good)

    def test_vendor_admin_boundary_is_a_hard_failure(self):
        self.clean_tree()
        self.write('apps/vendor-admin/app/pages/a.vue', "<script setup>import x from '../../../web/app/x'\nimport y from 'apps/web/app/y'</script>\n")
        self.write('apps/vendor-admin/server/api/b.ts', "import c from '@webvue/contracts'\n")
        self.write('apps/vendor-admin/server/api/c.ts', "const r = await $fetch('/api/v1/people')\n")
        self.write('apps/vendor-admin/app/pages/d.vue', "<script setup>import q from '../../../../packages/x'</script>\n")
        self.write('apps/vendor-admin/server/utils/e.js', "const m = await import(`~~/../web/x`)\n")
        self.write('apps/vendor-admin/nuxt.config.ts', "export default { extends: ['../../packages/ui'], alias: { w: '../web/app' } }\n")
        self.write('apps/vendor-admin/app/assets/css/f.css', "@source '../../../../web/app';\n")
        self.write('apps/vendor-admin/app/good.ts', "import { ref } from 'vue'\nimport z from '@webvue/commercial-contracts'\nimport c from '~/components/control-plane-status'\nfetch('/api/vendor/v1/context')\n")
        self.write('apps/vendor-admin/app/good.test.ts', "import x from 'apps/web/x'\nfetch('/api/v1/x')\n")
        self.write('apps/vendor-admin/tests/t.ts', "import x from 'apps/web/x'\n")
        self.write('apps/vendor-admin/e2e/t.ts', "fetch('/web/session')\n")
        self.write('apps/vendor-admin/node_modules/d/index.ts', "import x from 'apps/web/x'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual([h.split(' ')[1] for h in hard], [
            'apps/vendor-admin/app/assets/css/f.css',
            'apps/vendor-admin/app/pages/a.vue',
            'apps/vendor-admin/app/pages/d.vue',
            'apps/vendor-admin/nuxt.config.ts',
            'apps/vendor-admin/server/api/b.ts',
            'apps/vendor-admin/server/api/c.ts',
            'apps/vendor-admin/server/utils/e.js',
        ])
        self.assertTrue(all(h.startswith('VA1 ') for h in hard))

    def test_vendor_admin_test_exemption_is_tight(self):
        self.clean_tree()
        self.write('apps/vendor-admin/app/__tests__/t.ts', "import x from 'apps/web/x'\n")
        self.write('apps/vendor-admin/app/tests/t.ts', "import x from 'apps/web/x'\n")
        self.write('apps/vendor-admin/server/e2e/t.ts', "import x from 'apps/web/x'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual(len(hard), 3)

    def test_customer_app_importing_the_vendor_admin_is_a_hard_failure(self):
        self.clean_tree()
        self.write('apps/web/app/pages/x.vue', "<script setup>import a from '../../../vendor-admin/app/a'</script>\n")
        self.write('apps/web/app/ok.ts', "// see apps/vendor-admin for the admin app\nimport b from 'vue'\nimport c from './not-vendor-admin-list'\n")
        _, hard = collect(self.root, self.layers)
        self.assertEqual([h.split(' ')[1] for h in hard], ['apps/web/app/pages/x.vue'])

    def test_vendor_admin_patterns(self):
        app = Path('/r/apps/vendor-admin')
        page = app / 'app' / 'pages' / 'a.vue'
        css = app / 'app' / 'assets' / 'a.css'
        config = app / 'nuxt.config.ts'
        bad_cases = (
            (page, "import a from 'apps/web/x'"), (page, "import a from `apps/web/x`"), (page, "import '@webvue/contracts'"),
            (page, "import a from '@webvue/contracts/app/x'"), (page, "import a from 'odoo-addons/x'"),
            (page, "import c from '../../../control-plane/x'"), (page, "require('../../../apps/control-plane/x')"),
            (page, "import.meta.glob('../../../web/*.ts')"), (page, "import a from '../../../web/app/x'"),
            (page, "import a from '~~/../web/x'"), (page, "import a from '@@/../web/x'"), (page, "import a from '~/../../web/x'"),
            (page, "$fetch('/api/v1/people')"), (page, 'fetch("/web/session")'), (page, "const u = `/odoo/action`"),
            (page, "$fetch('/jsonrpc')"), (page, "get('/web')"), (page, "new WebSocket('/websocket')"),
            (page, "$fetch('/mail/x')"), (page, "$fetch('/longpolling/poll')"),
            (css, "@source '../../../../web/app';"), (css, "background: url(../../../../web/a.png);"),
            (config, "extends: ['../web']"), (config, "alias: { w: '../../packages/ui' }"),
        )
        for file, bad in bad_cases:
            self.assertGreaterEqual(vendor_admin_violations(bad, file, app), 1, bad)
        good_cases = (
            (page, "import a from 'vue'"), (page, "import b from '@webvue/ui/app/x'"), (page, "import c from '@webvue/commercial-ui/app/x'"),
            (page, "import d from '@webvue/commercial-contracts/server'"), (page, "import e from './web'"), (page, "import f from '~/composables/x'"),
            (page, "import g from '~/components/control-plane-status'"), (page, "import h from '../../utils/x'"),
            (page, "import i from '~~/server/utils/x'"), (page, "import j from '@/utils/x'"),
            (page, "// moved from apps/web/app/x"), (page, "see /api/v1/people in the old app"), (page, "fetch('/api/vendor/v1/context')"),
            (page, "const p = '/webhooks'"), (page, "const q = '/overview'"), (page, "const r = '/mailbox'"),
            (css, "@source '../../app';"), (css, "background: url(./a.png);"), (config, "extends: ['@webvue/ui']"),
        )
        for file, good in good_cases:
            self.assertEqual(vendor_admin_violations(good, file, app), 0, good)
        web = Path('/r/apps/web/app/a.ts')
        for bad in ("import a from '../../../vendor-admin/x'", "import a from '@webvue/vendor-admin/x'", "import a from `apps/vendor-admin/x`"):
            self.assertEqual(vendor_admin_imported(bad, web), 1, bad)
        for good in ("// see apps/vendor-admin/README", "import a from './vendor-admin-list'", "import a from '~/not-vendor-admin/x'"):
            self.assertEqual(vendor_admin_imported(good, web), 0, good)

    def test_clean_tree_has_no_violations(self):
        self.clean_tree()
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual({rule: found for rule, found in violations.items() if found}, {})

    def test_each_rule_fires_on_its_violation(self):
        self.addon('webvue_core', ['base', 'project'])
        self.addon('webvue_pmo', ['webvue_core', 'project'])
        self.write(
            'odoo-addons/webvue_core/models/access.py',
            HEADER + "from odoo.addons.webvue_pmo.models import x\nKEY = 'pmo.tasks.read'\nrows = env['res.users'].sudo()\n",
        )
        self.write(
            'odoo-addons/webvue_pmo/models/project_task.py',
            HEADER + "class T:\n    _inherit = 'project.task'\n    def _search(self, d):\n"
            "        self.env.cr.execute('SELECT id FROM project_task')\n        is_gov = True\n",
        )
        self.write('odoo-addons/webvue_pmo/tests/test_x.py', HEADER + "x = env['a'].sudo().sudo()\n")
        self.write('apps/web/app/components/hr/Card.vue', '<template><TaskRow /></template>\n')
        self.write('apps/web/app/utils/cp.ts', "import { x } from '../../../control-plane/src/x'\n// control-plane note\n")
        self.write('apps/web/app/pages/hr/index.vue', "<script setup>import type { Q } from '@webvue/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/index.vue', "<script setup>import type { Q } from '@webvue/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/ok.vue', "definePageMeta({ middleware: 'customer-commercial' })\n")
        self.write(
            'odoo-addons/webvue_pmo/controllers/tasks.py',
            HEADER + "class C:\n    @http.route('/api/v1/tasks')\n    def tasks(self):\n        pass\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R1'], {'webvue_core depends on project': 1})
        self.assertEqual(violations['R2'], {'odoo-addons/webvue_core/models/access.py': 2})
        self.assertEqual(
            violations['R3'],
            {'webvue_core imports webvue_pmo': 1, 'web apps/web/app/components/hr/Card.vue': 1},
        )
        self.assertEqual(
            violations['R5'],
            {
                'control-plane import apps/web/app/utils/cp.ts': 1,
                'commercial import apps/web/app/pages/hr/index.vue': 1,
            },
        )
        self.assertEqual(
            violations['R8'],
            {'apps/web/app/pages/subscription/index.vue lacks customer-commercial middleware': 1},
        )
        self.assertEqual(violations['R6'], {'odoo-addons/webvue_pmo/models/project_task.py': 1})
        self.assertEqual(violations['R7'], {'odoo-addons/webvue_core/models/access.py': 1})
        self.assertEqual(
            violations['R9'],
            {
                'sql odoo-addons/webvue_pmo/models/project_task.py': 1,
                'override odoo-addons/webvue_pmo/models/project_task.py': 1,
            },
        )
        self.assertEqual(
            violations['R10'],
            {
                'webvue_pmo registers no <app>.enabled feature it owns': 1,
                'odoo-addons/webvue_pmo/controllers/tasks.py:tasks has no requires_feature': 1,
            },
        )

    def test_a_gated_page_must_declare_the_middleware_in_define_page_meta(self):
        self.clean_tree()
        lacking = {
            'apps/web/app/pages/subscription/comment.vue': "<!-- customer-commercial -->\n<template><div /></template>\n",
            'apps/web/app/pages/subscription/line-comment.vue': "// customer-commercial\n<template><div /></template>\n",
            'apps/web/app/pages/subscription/commented-call.vue': "<!--\ndefinePageMeta({ middleware: 'customer-commercial' })\n-->\n<template><div /></template>\n",
            'apps/web/app/pages/subscription/string-only.vue': "<script setup>const note = 'customer-commercial'</script>\n",
            'apps/web/app/pages/subscription/other-middleware.vue': "definePageMeta({ middleware: 'auth' })\n",
        }
        for rel, text in lacking.items():
            self.write(rel, text)
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(
            violations['R8'],
            {f'{rel} lacks customer-commercial middleware': 1 for rel in lacking},
        )

    def test_a_page_declaring_the_middleware_in_define_page_meta_passes(self):
        self.clean_tree()
        self.write('apps/web/app/pages/subscription/plain.vue', "definePageMeta({ middleware: 'customer-commercial' })\n")
        self.write('apps/web/app/pages/subscription/array.vue', "definePageMeta({ middleware: ['auth', 'customer-commercial'] })\n")
        # A parenthesis inside an earlier string argument must not truncate the call before the middleware.
        self.write('apps/web/app/pages/subscription/string-before.vue',
                   "definePageMeta({ note: 'a)b', middleware: 'customer-commercial' })\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R8'], {})

    def test_a_gated_page_must_declare_the_middleware_property(self):
        # The name only counts as the `middleware` property's value, not as any string in the argument list.
        self.clean_tree()
        lacking = {
            'apps/web/app/pages/subscription/title-mentions-it.vue':
                "definePageMeta({ layout: false, title: 'customer-commercial', middleware: 'auth' })\n",
            'apps/web/app/pages/subscription/string-only.vue':
                "<script setup>const note = 'customer-commercial'</script>\n",
        }
        for rel, text in lacking.items():
            self.write(rel, text)
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(
            violations['R8'],
            {f'{rel} lacks customer-commercial middleware': 1 for rel in lacking},
        )

    def test_a_page_declaring_the_middleware_property_passes(self):
        self.clean_tree()
        self.write('apps/web/app/pages/subscription/plain.vue', "definePageMeta({ middleware: 'customer-commercial' })\n")
        self.write('apps/web/app/pages/subscription/array.vue', "definePageMeta({ middleware: ['auth', 'customer-commercial'] })\n")
        self.write('apps/web/app/pages/subscription/title-and-middleware.vue',
                   "definePageMeta({ title: 'customer-commercial', middleware: 'customer-commercial' })\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R8'], {})

    def test_application_xml_ids_count_as_r2(self):
        self.clean_tree()
        self.write('odoo-addons/webvue_core/models/x.py', HEADER + "g = self.env.ref('webvue_pmo.group_x')\n")
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R2'], {'odoo-addons/webvue_core/models/x.py': 1})

    def test_a_registered_application_prefix_counts_as_r2(self):
        self.clean_tree()
        self.layers['ranks']['webvue_sales'] = 4
        self.addon('webvue_sales', ['webvue_core'])
        self.write(
            'odoo-addons/webvue_sales/models/feature_registry.py',
            HEADER + "X = {'key': 'sales.enabled', 'owner': 'webvue_sales'}\n",
        )
        self.write(
            'odoo-addons/webvue_core/models/x.py',
            HEADER + "KEY = 'sales.orders.read'\ng = 'webvue_sales.group_x'\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R2'], {'odoo-addons/webvue_core/models/x.py': 2})

    def test_bridge_routes_need_requires_feature(self):
        self.clean_tree()
        self.layers['ranks']['webvue_meetings_pmo'] = 5
        self.addon('webvue_meetings_pmo', ['webvue_pmo'], extra='')
        self.write('odoo-addons/webvue_meetings_pmo/__manifest__.py', HEADER + repr(
            {'name': 'm', 'depends': ['webvue_pmo'], 'auto_install': True}))
        self.write(
            'odoo-addons/webvue_meetings_pmo/controllers/m.py',
            HEADER + "class C:\n    @http.route('/api/v1/m')\n    def m(self):\n        pass\n",
        )
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(
            violations['R10'], {'odoo-addons/webvue_meetings_pmo/controllers/m.py:m has no requires_feature': 1},
        )

    def test_upward_manifest_dependency_is_r4(self):
        self.clean_tree()
        self.addon('webvue_core', ['base', 'webvue_pmo'])
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R4'], {'webvue_core depends on webvue_pmo': 1})

    def test_unregistered_and_missing_addons_are_hard_failures(self):
        self.clean_tree()
        self.addon('webvue_sales', ['webvue_core'])
        self.addon('web_theme_shadcn', ['web'])
        self.layers['ranks']['webvue_gone'] = 4
        _, hard = collect(self.root, self.layers)
        self.assertEqual(
            hard,
            [
                'unregistered addon webvue_sales: add it to tools/arch_layers.json',
                'arch_layers.json lists missing addon webvue_gone',
            ],
        )

    def test_bridge_must_auto_install(self):
        self.clean_tree()
        self.layers['ranks']['webvue_meetings_pmo'] = 5
        self.addon('webvue_meetings_pmo', ['webvue_pmo'])
        _, hard = collect(self.root, self.layers)
        self.assertEqual(hard, ['bridge addon webvue_meetings_pmo must set auto_install'])

    def test_migrations_may_use_sql(self):
        self.clean_tree()
        self.write(
            'odoo-addons/webvue_pmo/migrations/19.0.1.1.0/pre-x.py',
            HEADER + "def migrate(cr, version):\n    cr.execute('UPDATE project_task SET x = 1')\n",
        )
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R9'], {})

    def test_baseline_file_shape_round_trips(self):
        self.clean_tree()
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(compare(violations, json.loads(json.dumps(violations))), [])

    def test_root_under_a_tests_directory_is_still_scanned(self):
        # Root path contains 'tests'; violations in non-test files must still be counted.
        self.root = Path(self.tmp.name) / 'tests' / 'repo'
        self.root.mkdir(parents=True)
        self.layers = {'ranks': {'webvue_core': 0, 'webvue_pmo': 4}, 'exempt': ['web_theme_shadcn'], 'web_apps': WEB_APPS,
                       'commercial': COMMERCIAL}
        self.addon('webvue_core', ['base'])
        self.addon('webvue_pmo', ['webvue_core', 'project'])
        self.write(
            'odoo-addons/webvue_pmo/models/feature_registry.py',
            HEADER + "X = {'key': 'pmo.enabled', 'owner': 'webvue_pmo'}\n",
        )
        self.write(
            'odoo-addons/webvue_pmo/models/project_task.py',
            HEADER + "class T:\n    def do(self):\n        x = env['res.users'].sudo()\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R7'], {'odoo-addons/webvue_pmo/models/project_task.py': 1})


class TestMain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'arch_layers.json'
        self.baseline_file = self.root / 'arch_baseline.json'
        self.layers_file.write_text(
            json.dumps({'ranks': {'webvue_core': 0}, 'exempt': [], 'web_apps': {}, 'commercial': {'pages': {}, 'allowed': []}}), encoding='utf-8',
        )
        self.manifest = self.root / 'odoo-addons' / 'webvue_core' / '__manifest__.py'
        self.manifest.parent.mkdir(parents=True)
        self.depends(['base', 'project'])

    def depends(self, names):
        self.manifest.write_text(HEADER + repr({'name': 'webvue_core', 'depends': names}), encoding='utf-8')

    def run_main(self, *argv):
        return main(list(argv), root=self.root, layers_file=self.layers_file, baseline_file=self.baseline_file)

    def test_missing_baseline_reports_existing_debt(self):
        self.assertEqual(self.run_main(), 1)

    def test_first_write_records_debt_and_then_passes(self):
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(json.loads(self.baseline_file.read_text())['R1'], {'webvue_core depends on project': 1})
        self.assertEqual(self.run_main(), 0)

    def test_later_write_refuses_an_increase_and_keeps_the_file(self):
        self.run_main('--write-baseline')
        before = self.baseline_file.read_text()
        self.depends(['base', 'project', 'hr'])
        self.assertEqual(self.run_main('--write-baseline'), 1)
        self.assertEqual(self.baseline_file.read_text(), before)

    def test_fixing_a_violation_requires_lowering_the_baseline(self):
        self.run_main('--write-baseline')
        self.depends(['base'])
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(self.run_main(), 0)

    def test_malformed_layers_file_is_an_error_not_a_pass(self):
        self.layers_file.write_text('{', encoding='utf-8')
        with self.assertRaises(json.JSONDecodeError):
            self.run_main()

    def test_rule_totals_sum_per_rule(self):
        self.assertEqual(rule_totals({'R7': {'a': 2, 'b': 3}, 'R1': {}}), {'R7': 5, 'R1': 0})

    def test_renamed_key_is_accepted_by_write_baseline_when_total_holds(self):
        self.run_main('--write-baseline')
        self.depends(['base', 'hr'])
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(json.loads(self.baseline_file.read_text())['R1'], {'webvue_core depends on hr': 1})
        self.assertEqual(self.run_main(), 0)

    def test_total_increase_is_refused_even_when_a_key_is_renamed(self):
        self.run_main('--write-baseline')
        before = self.baseline_file.read_text()
        self.depends(['base', 'hr', 'sale'])
        self.assertEqual(self.run_main('--write-baseline'), 1)
        self.assertEqual(self.baseline_file.read_text(), before)


class BaseRefCase(unittest.TestCase):
    """A temp git repo with a layers file, a baseline file and two addons; subclasses add the tests."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'tools' / 'arch_layers.json'
        self.baseline_file = self.root / 'tools' / 'arch_baseline.json'
        self.layers_file.parent.mkdir()
        self.set_layers(exempt=['web_theme_shadcn'])
        for name in ('a', 'b'):
            manifest = self.root / 'odoo-addons' / f'webvue_{name}' / '__manifest__.py'
            manifest.parent.mkdir(parents=True)
            manifest.write_text(HEADER + repr({'name': name, 'depends': ['webvue_core']}), encoding='utf-8')
        core = self.root / 'odoo-addons' / 'webvue_core' / '__manifest__.py'
        core.parent.mkdir(parents=True)
        core.write_text(HEADER + repr({'name': 'core', 'depends': ['base']}), encoding='utf-8')
        self.sudo('a', 2)
        self.git('init', '-q', '-b', 'main')

    def set_layers(self, exempt):
        self.layers = {
            'ranks': {'webvue_core': 0, 'webvue_a': 4, 'webvue_b': 4}, 'exempt': exempt, 'web_apps': {},
            'commercial': {'pages': {}, 'allowed': []},
        }
        self.write_layers()

    def write_layers(self):
        self.layers_file.write_text(json.dumps(self.layers), encoding='utf-8')

    def sudo(self, name, n):
        path = self.root / 'odoo-addons' / f'webvue_{name}' / 'models' / 'm.py'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(HEADER + "x = env['a']" + '.sudo()' * n + '\n' if n else HEADER, encoding='utf-8')

    def git(self, *args):
        return subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *args],
            cwd=self.root, check=True, capture_output=True, text=True, shell=False,
        )

    def commit_base(self):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'base')

    def run_main(self, *argv):
        return main(list(argv), root=self.root, layers_file=self.layers_file, baseline_file=self.baseline_file)

    def adopt(self):
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.commit_base()


class TestBaseRef(BaseRefCase):
    """--base REF ratchets the baseline and exempt list against a git ref (real git repo)."""

    def test_unchanged_tree_passes(self):
        self.adopt()
        self.assertEqual(self.run_main('--base', 'main'), 0)

    def test_first_adoption_has_no_ratchet_problems(self):
        self.commit_base()
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(self.run_main('--base', 'main'), 0)

    def test_deleted_baseline_then_rewrite_is_caught(self):
        self.adopt()
        self.baseline_file.unlink()
        self.assertEqual(self.run_main('--base', 'main'), 1)
        self.sudo('a', 5)
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(self.run_main('--base', 'main'), 1)

    def test_write_baseline_with_base_refuses_growth_over_the_ref(self):
        self.adopt()
        self.baseline_file.unlink()
        self.sudo('a', 5)
        before_exists = self.baseline_file.exists()
        self.assertEqual(self.run_main('--write-baseline', '--base', 'main'), 1)
        self.assertEqual(self.baseline_file.exists(), before_exists)

    def test_hand_raised_count_is_caught(self):
        self.adopt()
        data = json.loads(self.baseline_file.read_text())
        key = next(iter(data['R7']))
        data['R7'][key] += 3
        self.baseline_file.write_text(json.dumps(data), encoding='utf-8')
        self.sudo('a', 5)
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(self.run_main('--base', 'main'), 1)

    def test_exempt_growth_is_caught(self):
        self.adopt()
        self.set_layers(exempt=['web_theme_shadcn', 'webvue_new'])
        self.assertEqual(self.run_main('--base', 'main'), 1)

    def test_file_move_is_accepted_by_base(self):
        self.adopt()
        (self.root / 'odoo-addons/webvue_a/models/m.py').rename(self.root / 'odoo-addons/webvue_a/models/n.py')
        self.assertEqual(self.run_main('--write-baseline', '--base', 'main'), 0)
        self.assertEqual(self.run_main('--base', 'main'), 0)

    def test_unknown_ref_exits_two(self):
        self.adopt()
        self.assertEqual(self.run_main('--base', 'no-such-ref'), 2)


TRAILER = 'Architecture-approved-by: Owner <owner@example.com>'


class TestLayersRatchet(BaseRefCase):
    """--base REF also ratchets arch_layers.json; the owner trailer on a layers commit waives it."""

    def setUp(self):
        super().setUp()
        self.layers.update({
            'web_apps': {
                'pmo': {'components': ['project'], 'pages': ['projects']},
                'hr': {'components': ['hr'], 'pages': ['hr']},
            },
            'commercial': {
                'pages': {'vendor': 'vendor', 'subscription': 'customer-commercial'},
                'allowed': ['apps/web/app/pages/vendor/', 'apps/web/server/'],
            },
        })
        self.write_layers()
        for sub in ('components/project', 'components/hr', 'pages/projects', 'pages/hr'):
            (self.root / 'apps/web/app' / sub).mkdir(parents=True)
        self.commit_base()
        self.git('checkout', '-q', '-b', 'work')

    def problems(self):
        return ratchet_problems('main', self.root, self.layers_file, self.baseline_file, {}, False)

    def commit_layers(self, trailer=None):
        self.write_layers()
        self.git('add', '-A')
        args = ['commit', '-q', '--allow-empty', '-m', 'change layers']
        self.git(*args, *(['-m', trailer] if trailer else []))

    def weaken(self, name):
        layers = self.layers
        if name == 'rank':
            layers['ranks']['webvue_a'] = 3
            return 'rank of webvue_a changed 4 -> 3'
        if name == 'addon removed':
            del layers['ranks']['webvue_b']
            return 'webvue_b removed from arch_layers.json'
        if name == 'exempt':
            layers['exempt'].append('webvue_new')
            return 'exempt list grew: webvue_new'
        if name == 'allowed':
            layers['commercial']['allowed'].append('apps/web/app/pages/hr/')
            return 'commercial allowed list grew: apps/web/app/pages/hr/'
        if name == 'page removed':
            del layers['commercial']['pages']['vendor']
            return 'commercial page gate weakened: vendor'
        if name == 'middleware':
            layers['commercial']['pages']['subscription'] = 'other'
            return 'commercial page gate weakened: subscription'
        if name == 'web moved':
            layers['web_apps']['hr']['components'].remove('hr')
            layers['web_apps']['pmo']['components'].append('hr')
            return 'web app folder hr moved from hr to pmo'
        if name == 'web unlisted':
            layers['web_apps']['pmo']['pages'].remove('projects')
            return 'web app folder projects moved from pmo to nowhere'
        raise AssertionError(name)

    WEAKENINGS = (
        'rank', 'addon removed', 'exempt', 'allowed', 'page removed', 'middleware', 'web moved', 'web unlisted',
    )

    def test_each_weakening_is_reported(self):
        for name in self.WEAKENINGS:
            with self.subTest(name=name):
                self.setUp_layers_reset()
                expected = self.weaken(name)
                self.write_layers()
                self.assertIn(expected, self.problems())

    def setUp_layers_reset(self):
        self.layers = json.loads(self.git('show', 'main:tools/arch_layers.json').stdout)
        self.write_layers()

    def test_strengthening_is_not_reported(self):
        layers = self.layers
        layers['ranks']['webvue_c'] = 4
        (self.root / 'odoo-addons/webvue_c').mkdir()
        layers['web_apps']['hr']['pages'].append('hr-new')
        (self.root / 'apps/web/app/pages/hr-new').mkdir()
        layers['commercial']['pages']['invite'] = 'customer-commercial'
        layers['commercial']['allowed'].remove('apps/web/server/')
        self.write_layers()
        self.assertEqual(self.problems(), [])

    def test_removing_an_addon_whose_directory_is_gone_is_not_reported(self):
        del self.layers['ranks']['webvue_b']
        self.write_layers()
        shutil.rmtree(self.root / 'odoo-addons/webvue_b')
        self.assertEqual(self.problems(), [])

    def test_web_folder_that_no_longer_exists_is_not_reported(self):
        self.layers['web_apps']['pmo']['pages'].remove('projects')
        self.write_layers()
        shutil.rmtree(self.root / 'apps/web/app/pages/projects')
        self.assertEqual(self.problems(), [])

    def test_weakening_with_the_owner_trailer_passes(self):
        for name in self.WEAKENINGS:
            with self.subTest(name=name):
                self.setUp_layers_reset()
                self.git('reset', '-q', '--hard', 'main')
                self.layers = json.loads(self.layers_file.read_text())
                self.weaken(name)
                self.commit_layers(TRAILER)
                self.assertEqual(self.problems(), [])

    def test_the_same_weakening_without_the_trailer_fails(self):
        for name in self.WEAKENINGS:
            with self.subTest(name=name):
                self.git('reset', '-q', '--hard', 'main')
                self.layers = json.loads(self.layers_file.read_text())
                expected = self.weaken(name)
                self.commit_layers()
                self.assertIn(expected, self.problems())

    def test_trailer_on_a_commit_that_does_not_touch_the_layers_file_does_not_waive(self):
        expected = self.weaken('rank')
        self.commit_layers()
        (self.root / 'note.txt').write_text('x', encoding='utf-8')
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'unrelated', '-m', TRAILER)
        self.assertIn(expected, self.problems())

    def test_trailer_does_not_waive_baseline_total_growth(self):
        self.adopt()
        self.git('branch', '-f', 'main', 'work')
        self.git('checkout', '-q', '-b', 'work2')
        self.layers['exempt'].append('webvue_new')
        self.commit_layers(TRAILER)
        self.baseline_file.unlink()
        self.sudo('a', 5)
        self.assertEqual(self.run_main('--write-baseline', '--base', 'main'), 1)
        self.assertEqual(self.run_main('--base', 'main'), 1)

    def test_a_trailer_on_one_commit_does_not_waive_a_later_unapproved_change(self):
        self.layers['ranks']['webvue_a'] = 3
        self.commit_layers(TRAILER)
        self.layers['exempt'].append('webvue_new')
        self.commit_layers()
        # The trailer is read per commit, so one commit without it leaves the whole layers range unapproved.
        self.assertEqual(self.problems(), ['exempt list grew: webvue_new', 'rank of webvue_a changed 4 -> 3'])

    def test_a_trailer_on_every_layers_commit_waives_the_whole_range(self):
        self.layers['ranks']['webvue_a'] = 3
        self.commit_layers(TRAILER)
        self.layers['exempt'].append('webvue_new')
        self.commit_layers(TRAILER)
        self.assertEqual(self.problems(), [])


class TestLayersRatchetTags(BaseRefCase):
    """--base REF reports a dropped web_apps tag prefix, which would hide foreign component uses from R3."""

    def setUp(self):
        super().setUp()
        self.layers['web_apps'] = {
            'pmo': {'components': ['project'], 'pages': ['projects'], 'tags': ['Project', 'Task']},
            'hr': {'components': ['hr'], 'pages': ['hr'], 'tags': ['Hr']},
        }
        self.write_layers()
        self.commit_base()
        self.git('checkout', '-q', '-b', 'work')

    def problems(self):
        return ratchet_problems('main', self.root, self.layers_file, self.baseline_file, {}, False)

    def commit_layers(self, trailer=None):
        self.write_layers()
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', 'change layers', *(['-m', trailer] if trailer else []))

    def test_an_unchanged_tag_set_passes(self):
        self.assertEqual(self.problems(), [])

    def test_a_dropped_tag_is_reported(self):
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.write_layers()
        self.assertEqual(self.problems(), ['web app tag Task removed from pmo'])

    def test_a_tag_moved_to_another_app_is_reported(self):
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.layers['web_apps']['hr']['tags'].append('Task')
        self.write_layers()
        self.assertEqual(self.problems(), ['web app tag Task removed from pmo'])

    def test_adding_a_tag_is_not_a_weakening(self):
        self.layers['web_apps']['pmo']['tags'].append('Milestone')
        self.layers['web_apps']['hr']['tags'].append('Payroll')
        self.write_layers()
        self.assertEqual(self.problems(), [])

    def test_a_dropped_tag_with_the_owner_trailer_passes(self):
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.assertEqual(self.problems(), [])

    def test_a_dropped_tag_without_the_trailer_fails(self):
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers()
        self.assertEqual(self.problems(), ['web app tag Task removed from pmo'])

    def test_an_approved_weakening_and_a_registration_commit_are_approved(self):
        # Registering an addon touches the same file without weakening it, so the trailer belongs to the
        # weakening commit alone.
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.layers['ranks']['webvue_new'] = 4
        (self.root / 'odoo-addons/webvue_new').mkdir()
        self.commit_layers()
        self.assertEqual(self.problems(), [])

    def test_a_merge_carrying_an_approved_weakening_needs_no_trailer(self):
        # The documented integration shape: the owner-approved weakening is committed on its task branch and
        # then merged. The merge is a weakening against its first parent only, and must not need a trailer.
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', '-b', 'integration', 'main')
        self.git('merge', '-q', '--no-ff', '-m', 'merge the approved weakening', 'work')
        rel = 'tools/arch_layers.json'
        head = self.git('rev-parse', 'HEAD').stdout.strip()
        first_parent = self.git('rev-parse', 'HEAD^').stdout.strip()
        self.assertTrue(
            layer_weakenings(self.root, file_at(self.root, first_parent, rel), file_at(self.root, head, rel)),
            'the merge must look like a weakening against its first parent, or this test proves nothing',
        )
        self.assertEqual(self.problems(), [])

    def test_a_merge_that_introduces_a_weakening_still_needs_the_trailer(self):
        # A conflict resolution: the layers file is one line, so the two branches conflict and the merge
        # carries content no parent holds, including a weakening of its own that no commit approved.
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', '-b', 'integration', 'main')
        self.layers['ranks']['webvue_c'] = 4
        (self.root / 'odoo-addons/webvue_c').mkdir()
        self.commit_layers()
        conflict = subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-ff', 'work'],
            cwd=self.root, capture_output=True, text=True, check=False, shell=False,
        )
        self.assertNotEqual(conflict.returncode, 0, 'this merge must conflict for the test to exercise a resolution')
        merged = json.loads(self.git('show', 'work:tools/arch_layers.json').stdout)
        merged['ranks']['webvue_c'] = 4
        merged['exempt'].append('webvue_new')
        self.layers_file.write_text(json.dumps(merged), encoding='utf-8')
        self.git('add', '-A')
        self.git('commit', '-q', '--no-edit')
        self.assertEqual(len(commit_parents(self.root, self.git('rev-parse', 'HEAD').stdout.strip())), 2)
        self.assertEqual(self.problems(), ['exempt list grew: webvue_new', 'web app tag Task removed from pmo'])

    def test_a_merge_of_two_approved_weakenings_needs_no_trailer(self):
        # Two branches introduce a weakening each, both owner-approved. The merge introduces neither: each
        # weakening already exists in one of its parents, so the merge itself needs no trailer.
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', '-b', 'other', 'main')
        self.layers = json.loads(self.layers_file.read_text())
        self.layers['exempt'].append('webvue_new')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', 'work')
        self.layers = json.loads(self.layers_file.read_text())
        conflict = subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-ff', 'other'],
            cwd=self.root, capture_output=True, text=True, check=False, shell=False,
        )
        self.assertNotEqual(conflict.returncode, 0, 'this merge must conflict for the test to exercise a resolution')
        merged = json.loads(self.git('show', 'other:tools/arch_layers.json').stdout)
        merged['web_apps']['pmo']['tags'].remove('Task')
        self.layers_file.write_text(json.dumps(merged), encoding='utf-8')
        self.git('add', '-A')
        self.git('commit', '-q', '--no-edit')
        self.assertEqual(self.problems(), [])

    def test_a_merge_introducing_a_weakening_needs_its_own_trailer(self):
        # The complement: the resolution grows the commercial allowlist, which no parent holds, so the merge
        # introduces that weakening and needs the owner trailer itself.
        self.layers['web_apps']['pmo']['tags'].remove('Task')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', '-b', 'other', 'main')
        self.layers = json.loads(self.layers_file.read_text())
        self.layers['exempt'].append('webvue_new')
        self.commit_layers(TRAILER)
        self.git('checkout', '-q', 'work')
        self.layers = json.loads(self.layers_file.read_text())
        conflict = subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-ff', 'other'],
            cwd=self.root, capture_output=True, text=True, check=False, shell=False,
        )
        self.assertNotEqual(conflict.returncode, 0, 'this merge must conflict for the test to exercise a resolution')
        merged = json.loads(self.git('show', 'other:tools/arch_layers.json').stdout)
        merged['web_apps']['pmo']['tags'].remove('Task')
        merged['commercial']['allowed'].append('apps/web/app/pages/hr/')
        self.layers_file.write_text(json.dumps(merged), encoding='utf-8')
        self.git('add', '-A')
        self.git('commit', '-q', '--no-edit')
        self.assertIn('commercial allowed list grew: apps/web/app/pages/hr/', self.problems())
        self.git('commit', '-q', '--amend', '-m', 'merge other', '-m', TRAILER)
        self.assertEqual(self.problems(), [])


class TestDocumentedSudo(BaseRefCase):
    """R7 documented cases: a separate approved allowlist next to the shrink-only baseline."""

    AGENTS = '# Agents\n\n- `webvue_a` has no `sudo()` path. `webvue_b` uses it only for X.\n- next item\n'

    def setUp(self):
        super().setUp()
        self.documented_file = self.root / 'tools' / 'arch_documented_sudo.json'
        self.b_file = 'odoo-addons/webvue_b/models/m.py'
        (self.root / 'AGENTS.md').write_text(self.AGENTS, encoding='utf-8')
        self.sudo('b', 2)

    def document(self, count, rel=None):
        cases = {rel or self.b_file: {'count': count, 'reason': 'test'}}
        self.documented_file.write_text(json.dumps({'cases': cases}), encoding='utf-8')

    def problems(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stderr(out):
            code = self.run_main(*argv)
        return code, out.getvalue()

    def adopt_documented(self):
        self.document(2)
        self.adopt()

    def test_documented_case_allows_exactly_its_count_and_stays_out_of_the_baseline(self):
        self.adopt_documented()
        self.assertEqual(self.problems(), (0, ''))
        self.assertEqual(json.loads(self.baseline_file.read_text())['R7'], {'odoo-addons/webvue_a/models/m.py': 2})

    def test_excess_over_the_documented_count_fails(self):
        self.adopt_documented()
        self.sudo('b', 3)
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.b_file}: 1 found, baseline allows 0', text)

    def test_a_file_in_neither_list_fails(self):
        self.adopt_documented()
        (self.root / 'odoo-addons/webvue_b/models/n.py').write_text(HEADER + "x = y.sudo()\n", encoding='utf-8')
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn('odoo-addons/webvue_b/models/n.py: 1 found, baseline allows 0', text)

    def test_baseline_growth_logic_is_unchanged(self):
        self.adopt_documented()
        self.sudo('a', 5)
        self.baseline_file.unlink()
        self.assertEqual(self.run_main('--write-baseline', '--base', 'main'), 1)

    def test_documented_count_is_not_part_of_the_totals(self):
        self.sudo('b', 0)
        self.adopt()
        self.sudo('b', 2)
        self.document(2)
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(rule_totals(json.loads(self.baseline_file.read_text()))['R7'], 2)

    def test_new_case_without_the_trailer_fails_and_with_it_passes(self):
        self.sudo('b', 0)
        self.adopt()
        self.git('checkout', '-q', '-b', 'work')
        self.sudo('b', 2)
        self.document(2)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'document')
        code, text = self.problems('--base', 'main')
        self.assertEqual(code, 1)
        self.assertIn('documented sudo case added without Architecture-approved-by', text)
        self.git('commit', '-q', '--amend', '-m', 'document', '-m', TRAILER)
        self.assertEqual(self.problems('--base', 'main'), (0, ''))

    def test_raised_count_needs_the_trailer_and_a_net_lower_one_does_not(self):
        self.adopt_documented()
        self.git('checkout', '-q', '-b', 'work')
        self.sudo('b', 3)
        self.document(3)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'raise')
        self.assertEqual(self.problems('--base', 'main')[0], 1)
        self.sudo('b', 1)
        self.document(1)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'lower')
        self.assertEqual(self.problems('--base', 'main')[0], 0, 'net lower than REF')

    def test_stale_or_missing_case_is_reported(self):
        self.adopt_documented()
        self.document(3)
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.b_file}: 2 found, documented sudo case says 3', text)
        self.document(1, rel='odoo-addons/webvue_b/models/gone.py')
        self.assertIn('gone.py: 0 found, documented sudo case says 1', self.problems()[1])

    def test_case_must_be_described_in_agents_md(self):
        self.adopt_documented()
        (self.root / 'AGENTS.md').write_text(self.AGENTS.replace('`webvue_b`', 'webvue_b'), encoding='utf-8')
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.b_file}: documented case not described in AGENTS.md', text)

    def test_write_baseline_refuses_a_stale_case_and_leaves_the_baseline_alone(self):
        self.adopt_documented()
        before = self.baseline_file.read_text(encoding='utf-8')
        self.sudo('a', 1)
        self.sudo('b', 1)
        code, text = self.problems('--write-baseline')
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.b_file}: 1 found, documented sudo case says 2', text)
        self.assertEqual(self.baseline_file.read_text(encoding='utf-8'), before)

    def test_write_baseline_refuses_an_undescribed_case_and_leaves_the_baseline_alone(self):
        self.adopt_documented()
        before = self.baseline_file.read_text(encoding='utf-8')
        self.sudo('a', 1)
        (self.root / 'AGENTS.md').write_text(self.AGENTS.replace('`webvue_b`', 'webvue_b'), encoding='utf-8')
        code, text = self.problems('--write-baseline')
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.b_file}: documented case not described in AGENTS.md', text)
        self.assertEqual(self.baseline_file.read_text(encoding='utf-8'), before)

    def test_write_baseline_still_passes_on_an_unchanged_tree_and_baseline(self):
        self.adopt_documented()
        self.assertEqual(self.problems('--write-baseline'), (0, ''))

    def test_write_baseline_still_writes_when_the_documented_case_matches(self):
        self.adopt_documented()
        self.sudo('a', 1)
        self.assertEqual(self.problems('--write-baseline'), (0, ''))
        self.assertEqual(
            json.loads(self.baseline_file.read_text(encoding='utf-8'))['R7'],
            {'odoo-addons/webvue_a/models/m.py': 1},
        )


class TestRepository(unittest.TestCase):
    def test_repository_matches_baseline(self):
        """The real tree against tools/arch_baseline.json; this is what `npm test` enforces."""
        self.assertEqual(main([]), 0, 'run: python3 -B tools/arch_policy.py')


if __name__ == '__main__':
    unittest.main()

# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import tempfile
import unittest
from pathlib import Path

from arch_policy import (
    collect,
    compare,
    core_depends_violations,
    foreign_component_uses,
    is_test_path,
    layer_violations,
    main,
    odoo_access_overrides,
    routes_without_feature,
    sql_on_odoo_tables,
    sudo_calls,
    unregistered_addons,
)

RANKS = {'nasq_core': 0, 'nasq_platform': 1, 'nasq_api': 2, 'nasq_pmo': 4, 'nasq_hr': 4, 'nasq_meetings_pmo': 5}
WEB_APPS = {
    'pmo': {'components': ['project', 'task'], 'pages': ['projects', 'tasks']},
    'hr': {'components': ['hr'], 'pages': ['hr']},
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
            {'nasq_core depends on project': 1, 'nasq_core depends on hr': 1},
        )

    def test_dependencies_must_point_strictly_down(self):
        self.assertEqual(layer_violations('nasq_pmo', ['nasq_api', 'project', 'nasq_pmo'], RANKS, 'depends on'), {})
        self.assertEqual(
            layer_violations('nasq_pmo', ['nasq_hr'], RANKS, 'imports'),
            {'nasq_pmo imports nasq_hr': 1},
        )
        self.assertEqual(
            layer_violations('nasq_core', ['nasq_platform', 'nasq_platform'], RANKS, 'imports'),
            {'nasq_core imports nasq_platform': 2},
        )
        self.assertEqual(layer_violations('nasq_meetings_pmo', ['nasq_pmo', 'nasq_api'], RANKS, 'depends on'), {})

    def test_unregistered_addons_are_listed(self):
        self.assertEqual(
            unregistered_addons(['nasq_core', 'nasq_sales', 'web_theme_shadcn'], RANKS, ['web_theme_shadcn']),
            ['nasq_sales'],
        )

    def test_sql_counts_only_non_nasq_tables(self):
        text = 'SELECT 1 FROM hr_employee e JOIN nasq_access_role r ON 1=1; UPDATE res_users SET x=1'
        self.assertEqual(sql_on_odoo_tables(text), 2)
        self.assertEqual(sql_on_odoo_tables('returns rows from the cache'), 0)

    def test_access_overrides_count_only_on_odoo_models(self):
        override = '    def _search(self, domain):\n        pass\n    def check_access(self, operation):\n        pass\n'
        self.assertEqual(odoo_access_overrides("    _inherit = 'hr.employee'\n" + override), 2)
        self.assertEqual(odoo_access_overrides("    _inherit = 'nasq.access.role'\n" + override), 0)
        self.assertEqual(odoo_access_overrides("    _name = 'nasq.thing'\n" + override), 0)

    def test_sudo_counts_calls_not_comments_or_strings(self):
        text = "# x.sudo() in a comment\nA = 'y.sudo()'\nb = env['res.users'].sudo().browse(1).sudo()\n"
        self.assertEqual(sudo_calls(text), 2)

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

    def test_test_paths_are_recognised(self):
        self.assertTrue(is_test_path(Path('odoo-addons/nasq_pmo/tests/test_tasks.py')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/__tests__/a.ts')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/a.test.ts')))
        self.assertFalse(is_test_path(Path('odoo-addons/nasq_pmo/models/project_task.py')))


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
        self.layers = {'ranks': {'nasq_core': 0, 'nasq_pmo': 4}, 'exempt': ['web_theme_shadcn'], 'web_apps': WEB_APPS,
                       'commercial': COMMERCIAL}

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def addon(self, name, depends, extra=''):
        self.write(f'odoo-addons/{name}/__manifest__.py', HEADER + repr({'name': name, 'depends': depends}) + extra)

    def clean_tree(self):
        self.addon('nasq_core', ['base'])
        self.addon('nasq_pmo', ['nasq_core', 'project'])
        self.write(
            'odoo-addons/nasq_pmo/models/feature_registry.py',
            HEADER + "X = {'key': 'pmo.enabled', 'owner': 'nasq_pmo'}\n",
        )

    def test_clean_tree_has_no_violations(self):
        self.clean_tree()
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual({rule: found for rule, found in violations.items() if found}, {})

    def test_each_rule_fires_on_its_violation(self):
        self.addon('nasq_core', ['base', 'project'])
        self.addon('nasq_pmo', ['nasq_core', 'project'])
        self.write(
            'odoo-addons/nasq_core/models/access.py',
            HEADER + "from odoo.addons.nasq_pmo.models import x\nKEY = 'pmo.tasks.read'\nrows = env['res.users'].sudo()\n",
        )
        self.write(
            'odoo-addons/nasq_pmo/models/project_task.py',
            HEADER + "class T:\n    _inherit = 'project.task'\n    def _search(self, d):\n"
            "        self.env.cr.execute('SELECT id FROM project_task')\n        is_gov = True\n",
        )
        self.write('odoo-addons/nasq_pmo/tests/test_x.py', HEADER + "x = env['a'].sudo().sudo()\n")
        self.write('apps/web/app/components/hr/Card.vue', '<template><TaskRow /></template>\n')
        self.write('apps/web/app/utils/cp.ts', "import { x } from '../../../control-plane/src/x'\n// control-plane note\n")
        self.write('apps/web/app/pages/hr/index.vue', "<script setup>import type { Q } from '@nasq/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/index.vue', "<script setup>import type { Q } from '@nasq/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/ok.vue', "definePageMeta({ middleware: 'customer-commercial' })\n")
        self.write(
            'odoo-addons/nasq_pmo/controllers/tasks.py',
            HEADER + "class C:\n    @http.route('/api/v1/tasks')\n    def tasks(self):\n        pass\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R1'], {'nasq_core depends on project': 1})
        self.assertEqual(violations['R2'], {'odoo-addons/nasq_core/models/access.py': 1})
        self.assertEqual(
            violations['R3'],
            {'nasq_core imports nasq_pmo': 1, 'web apps/web/app/components/hr/Card.vue': 1},
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
        self.assertEqual(violations['R6'], {'odoo-addons/nasq_pmo/models/project_task.py': 1})
        self.assertEqual(violations['R7'], {'odoo-addons/nasq_core/models/access.py': 1})
        self.assertEqual(
            violations['R9'],
            {
                'sql odoo-addons/nasq_pmo/models/project_task.py': 1,
                'override odoo-addons/nasq_pmo/models/project_task.py': 1,
            },
        )
        self.assertEqual(
            violations['R10'],
            {
                'nasq_pmo registers no <app>.enabled feature it owns': 1,
                'odoo-addons/nasq_pmo/controllers/tasks.py:tasks has no requires_feature': 1,
            },
        )

    def test_upward_manifest_dependency_is_r4(self):
        self.clean_tree()
        self.addon('nasq_core', ['base', 'nasq_pmo'])
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R4'], {'nasq_core depends on nasq_pmo': 1})

    def test_unregistered_and_missing_addons_are_hard_failures(self):
        self.clean_tree()
        self.addon('nasq_sales', ['nasq_core'])
        self.addon('web_theme_shadcn', ['web'])
        self.layers['ranks']['nasq_gone'] = 4
        _, hard = collect(self.root, self.layers)
        self.assertEqual(
            hard,
            [
                'unregistered addon nasq_sales: add it to tools/arch_layers.json',
                'arch_layers.json lists missing addon nasq_gone',
            ],
        )

    def test_bridge_must_auto_install(self):
        self.clean_tree()
        self.layers['ranks']['nasq_meetings_pmo'] = 5
        self.addon('nasq_meetings_pmo', ['nasq_pmo'])
        _, hard = collect(self.root, self.layers)
        self.assertEqual(hard, ['bridge addon nasq_meetings_pmo must set auto_install'])

    def test_migrations_may_use_sql(self):
        self.clean_tree()
        self.write(
            'odoo-addons/nasq_pmo/migrations/19.0.1.1.0/pre-x.py',
            HEADER + "def migrate(cr, version):\n    cr.execute('UPDATE project_task SET x = 1')\n",
        )
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R9'], {})

    def test_baseline_file_shape_round_trips(self):
        self.clean_tree()
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(compare(violations, json.loads(json.dumps(violations))), [])


class TestMain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'arch_layers.json'
        self.baseline_file = self.root / 'arch_baseline.json'
        self.layers_file.write_text(
            json.dumps({'ranks': {'nasq_core': 0}, 'exempt': [], 'web_apps': {}, 'commercial': {'pages': {}, 'allowed': []}}), encoding='utf-8',
        )
        self.manifest = self.root / 'odoo-addons' / 'nasq_core' / '__manifest__.py'
        self.manifest.parent.mkdir(parents=True)
        self.depends(['base', 'project'])

    def depends(self, names):
        self.manifest.write_text(HEADER + repr({'name': 'nasq_core', 'depends': names}), encoding='utf-8')

    def run_main(self, *argv):
        return main(list(argv), root=self.root, layers_file=self.layers_file, baseline_file=self.baseline_file)

    def test_missing_baseline_reports_existing_debt(self):
        self.assertEqual(self.run_main(), 1)

    def test_first_write_records_debt_and_then_passes(self):
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(json.loads(self.baseline_file.read_text())['R1'], {'nasq_core depends on project': 1})
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


class TestRepository(unittest.TestCase):
    def test_repository_matches_baseline(self):
        """The real tree against tools/arch_baseline.json; this is what `npm test` enforces."""
        self.assertEqual(main([]), 0, 'run: python3 -B tools/arch_policy.py')


if __name__ == '__main__':
    unittest.main()

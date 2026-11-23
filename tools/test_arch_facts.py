# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tests for tools/arch_facts.py."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from arch_facts import build_facts, main, render

HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.\n'
SUDO_FILE = 'odoo-addons/liwan_core/models/m.py'

VIOLATIONS = {'R7': {
    'odoo-addons/liwan_pmo/models/project_project.py': 3,
    'odoo-addons/liwan_pmo/models/project_task.py': 2,
    'odoo-addons/liwan_hr/models/hr_employee.py': 1,
}}
DOCUMENTED = {'cases': {
    'odoo-addons/liwan_pmo/models/project_project.py': {'count': 3, 'reason': 'a', 'kind': 'acl_gap'},
    'odoo-addons/liwan_pmo/models/project_task.py': {'count': 2, 'reason': 'b', 'kind': 'acl_gap'},
    'odoo-addons/liwan_hr/models/hr_employee.py': {'count': 1, 'reason': 'c', 'kind': 'own_design'},
}}
BASELINE = {
    'R3': {
        'bridge-limit recorded': 0,
        'bridge-model odoo-addons/liwan_api_account': 1,
        'bridge-size odoo-addons/liwan_hr_finance': 407,
    },
    'R9': {
        'override odoo-addons/liwan_hr/models/hr_employee.py': 4,
        'sql odoo-addons/liwan_hr/models/hr_employee.py': 11,
        'sql odoo-addons/liwan_pmo/models/project_project.py': 2,
    },
    'R10': {'odoo-addons/liwan_pmo/controllers/tasks.py:list has no requires_feature': 1},
}
RANKS = {'liwan_core': 0, 'liwan_api': 2, 'liwan_hr': 4, 'liwan_pmo': 4, 'liwan_hr_pmo': 5}


class FactsCase(unittest.TestCase):
    def facts(self, violations=VIOLATIONS, documented=DOCUMENTED, baseline=BASELINE, ranks=RANKS):
        return build_facts(violations, documented, baseline, ranks)


class TestSudoFacts(FactsCase):
    """R7: the `collect()` sites, per addon, plus the documented registry that covers them."""

    def test_sites_files_and_per_addon_order(self):
        sudo = self.facts()['sudo']
        self.assertEqual((sudo['source'], sudo['sites'], sudo['files']), ('collect()', 6, 3))
        self.assertEqual(sudo['per_addon'], [{'addon': 'liwan_pmo', 'sites': 5}, {'addon': 'liwan_hr', 'sites': 1}])

    def test_the_documented_registry_is_reported_with_its_source(self):
        documented = self.facts()['sudo']['documented']
        self.assertEqual((documented['source'], documented['sites'], documented['files']), ('arch_documented_sudo.json', 6, 3))

    def test_cases_report_their_kind(self):
        kinds = self.facts()['sudo']['kinds']
        self.assertEqual(kinds['source'], 'arch_documented_sudo.json')
        self.assertEqual(kinds['totals'], [{'kind': 'acl_gap', 'sites': 5}, {'kind': 'own_design', 'sites': 1}])

    def test_no_kind_block_when_no_case_carries_one(self):
        cases = {rel: {'count': case['count'], 'reason': case['reason']} for rel, case in DOCUMENTED['cases'].items()}
        self.assertNotIn('kinds', self.facts(documented={'cases': cases})['sudo'])


class TestR9Facts(FactsCase):
    """R9: the baseline's own sub-entries, never a scan."""

    def test_totals_and_sub_entries(self):
        r9 = self.facts()['r9']
        self.assertEqual((r9['source'], r9['entries'], r9['files']), ('arch_baseline.json', 17, 2))
        self.assertEqual(r9['sub_entries'], [
            {'kind': 'override', 'entries': 4, 'files': 1},
            {'kind': 'sql', 'entries': 13, 'files': 2},
        ])


class TestBaselineRules(FactsCase):
    """Every other baselined rule reports its total and the paths it names; R9 is reported apart."""

    def test_rules_totals_and_file_counts(self):
        rules = {rule['rule']: rule for rule in self.facts()['baseline_rules']}
        self.assertEqual(sorted(rules), ['R10', 'R3'])
        self.assertEqual((rules['R3']['source'], rules['R3']['entries'], rules['R3']['files']), ('arch_baseline.json', 408, 2))
        self.assertEqual((rules['R10']['entries'], rules['R10']['files']), (1, 1))

    def test_ranks_count_their_addons(self):
        self.assertEqual(self.facts()['ranks'], [
            {'rank': 0, 'addons': 1},
            {'rank': 2, 'addons': 1},
            {'rank': 4, 'addons': 2},
            {'rank': 5, 'addons': 1},
        ])


class TestRender(FactsCase):
    def test_the_table_names_every_source(self):
        text = render(self.facts())
        for source in ('collect()', 'arch_documented_sudo.json', 'arch_baseline.json', 'arch_layers.json'):
            self.assertIn(source, text)
        self.assertIn('sites 6, files 3', text)
        self.assertIn('R9 direct SQL and overrides [arch_baseline.json]: entries 17, files 2', text)
        self.assertIn('acl_gap 5', text)
        self.assertIn('rank 4: addons 2', text)


class MainCase(unittest.TestCase):
    """A temp tree with one core addon, its baseline, the documented cases and the layers."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'tools' / 'arch_layers.json'
        self.baseline_file = self.root / 'tools' / 'arch_baseline.json'
        self.documented_file = self.root / 'tools' / 'arch_documented_sudo.json'
        self.layers_file.parent.mkdir()
        layers = {'ranks': {'liwan_core': 0}, 'exempt': [], 'web_apps': {}, 'commercial': {'pages': {}, 'allowed': []}}
        self.layers_file.write_text(json.dumps(layers), encoding='utf-8')
        self.write('odoo-addons/liwan_core/__manifest__.py', HEADER + repr({'name': 'core', 'depends': ['base']}))
        self.write(SUDO_FILE, HEADER + 'a = env.sudo()\n')
        self.baseline_file.write_text(json.dumps({'R7': {}, 'R9': {f'sql {SUDO_FILE}': 1}}), encoding='utf-8')
        self.documented_file.write_text(
            json.dumps({'cases': {SUDO_FILE: {'count': 1, 'reason': 'r', 'kind': 'acl_gap'}}}), encoding='utf-8',
        )

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def output(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(list(argv), root=self.root, layers_file=self.layers_file,
                        baseline_file=self.baseline_file, documented_file=self.documented_file)
        return code, out.getvalue()

    def test_the_text_table_reports_the_tree(self):
        code, text = self.output()
        self.assertEqual(code, 0)
        self.assertIn('sudo (R7) [collect()]: sites 1, files 1', text)
        self.assertIn('  liwan_core 1', text)
        self.assertIn('acl_gap 1', text)
        self.assertIn('rank 0: addons 1', text)

    def test_json_prints_the_same_facts(self):
        code, text = self.output('--json')
        self.assertEqual(code, 0)
        facts = json.loads(text)
        self.assertEqual(facts['sudo']['sites'], 1)
        self.assertEqual(facts['r9']['sub_entries'], [{'kind': 'sql', 'entries': 1, 'files': 1}])


class TestRepository(unittest.TestCase):
    def test_the_command_reports_the_repository_facts(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(main(['--json']), 0)
        facts = json.loads(out.getvalue())
        self.assertGreater(facts['sudo']['sites'], 0)
        self.assertEqual(facts['sudo']['sites'], sum(entry['sites'] for entry in facts['sudo']['per_addon']))
        self.assertNotIn('R9', [rule['rule'] for rule in facts['baseline_rules']])
        self.assertTrue(facts['ranks'])


if __name__ == '__main__':
    unittest.main()

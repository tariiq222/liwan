# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from arch_policy import sudo_calls, sudo_sites
from sudo_gate import (
    ACCESS_TOKEN,
    CALL_TOKEN,
    REASON_MIN_WORDS,
    allowances,
    main,
    reason_problems,
    undocumented_sites,
)

HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.\n'
TRAILER = 'Architecture-approved-by: owner'
# A reason of the shape AGENTS.md requires: the elevating call, then the blocking rule and its file.
REASON = (
    "webvue_pmo project charter reference: `self.env['project.project'].sudo().search_count([...])` counts the "
    "catalog usage; blocked by `rule_webvue_project_owning_unit_current_company` in security/project_charter_rules.xml."
)


def sudo_text(n: int) -> str:
    return HEADER + "x = env['a']" + '.sudo()' * n + '\n'


class TestSudoSites(unittest.TestCase):
    """`arch_policy.sudo_sites` names what `sudo_calls` counts, so the gate can report file:line."""

    def test_sites_report_their_line_and_kind(self):
        text = HEADER + 'a = env.sudo()\nb = other.sudo()\nc = env(su=True)\nd = SUPERUSER_ID\n'
        self.assertEqual(sudo_calls(text), 4)
        self.assertEqual(sudo_sites(text), [(2, 'sudo'), (3, 'sudo'), (4, 'su'), (5, 'SUPERUSER_ID')])

    def test_comments_strings_and_su_false_are_not_sites(self):
        text = HEADER + "# x.sudo()\ns = 'y.sudo()'\nz = env(su=False)\n"
        self.assertEqual(sudo_sites(text), [])

    def test_migrations_style_scan_drops_superuser_id(self):
        text = HEADER + 'w = SUPERUSER_ID\nv = a.sudo()\n'
        self.assertEqual(sudo_sites(text, superuser_id=False), [(3, 'sudo')])


class TestReasonShape(unittest.TestCase):
    """R7: a documented reason names the call and the blocking ACL, and no two cases share one."""

    def problems(self, *reasons):
        return reason_problems({f'odoo-addons/webvue_x/models/m{i}.py': {'count': 1, 'reason': r} for i, r in enumerate(reasons)})

    def test_a_specific_reason_passes(self):
        self.assertEqual(self.problems(REASON), [])
        self.assertGreaterEqual(len(REASON.split()), REASON_MIN_WORDS)
        self.assertTrue(CALL_TOKEN.search(REASON))
        self.assertTrue(ACCESS_TOKEN.search(REASON))

    def test_empty_missing_and_prose_only_reasons_fail(self):
        for case in ({'count': 1}, {'count': 1, 'reason': ''}, {'count': 1, 'reason': '   '}, {'count': 1, 'reason': None}):
            with self.subTest(case=case):
                self.assertEqual(len(reason_problems({'odoo-addons/webvue_x/models/m.py': case})), 1)
        for boilerplate in (
            'It is required for the feature to work.',
            'sudo is needed here because the operation must run as superuser for all users of every company.',
            'Security: this call must bypass permissions while the tenant profile is being loaded by the service.',
        ):
            with self.subTest(reason=boilerplate):
                problems = self.problems(boilerplate)
                self.assertEqual(len(problems), 1, boilerplate)
                self.assertIn('not specific enough', problems[0])

    def test_a_reason_without_the_call_or_without_the_acl_fails(self):
        no_call = 'It must run as superuser while the charter usage is counted, because the record rules hide it.'
        no_acl = "webvue_pmo charter reference: `self.env['project.project'].sudo().search_count([...])` counts usage."
        self.assertIn('the elevating call', self.problems(no_call)[0])
        self.assertIn('the blocking ACL', self.problems(no_acl)[0])
        # The audit vocabulary of every addon counts as a named blocker.
        for acl in ('`access_webvue_tenant_profile_system`', '`rule_task_current_company`', '`_webvue_fresh_company_domain`',
                    '`res_company_rule_employee`', '`task_type_visibility_rule`', 'security/meeting_access.xml',
                    '`ir.model.access`', 'the `finance.setup.manage` capability', '`group_cap_meetings_read`'):
            with self.subTest(acl=acl):
                self.assertEqual(self.problems(f'webvue_x `name_of_the_call` is blocked by {acl} for the caller.'), [])

    def test_two_cases_may_not_share_a_reason(self):
        problems = self.problems(REASON, REASON)
        self.assertEqual(len(problems), 1)
        self.assertIn('duplicates the reason of', problems[0])
        # Spacing differences are the same reason.
        self.assertEqual(len(self.problems(REASON, REASON.replace(' ', '  '))), 1)


class TestAllowedSites(unittest.TestCase):
    """The allowance of a file is its baseline count plus its documented case count."""

    def test_allowances_add_the_two_sources(self):
        self.assertEqual(
            allowances({'a.py': 2, 'b.py': 1}, {'a.py': 1, 'c.py': 3}),
            {'a.py': 3, 'b.py': 1, 'c.py': 3},
        )

    def test_only_the_sites_beyond_the_allowance_are_reported(self):
        self.assertEqual(undocumented_sites({'a.py': [1, 2, 3]}, {'a.py': 3}), [])
        problems = undocumented_sites({'a.py': [10, 40]}, {'a.py': 1})
        self.assertEqual(len(problems), 1)
        self.assertIn('R7: a.py:40: sudo() has no documented justification', problems[0])
        self.assertIn('2 found, 1 allowed', problems[0])
        self.assertEqual(len(undocumented_sites({'a.py': [10]}, {})), 1)


class GateCase(unittest.TestCase):
    """A temp tree with one core addon, its baseline, the documented cases and the AGENTS.md paragraph."""

    ADDON = 'odoo-addons/webvue_core/models/m.py'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'tools' / 'arch_layers.json'
        self.baseline_file = self.root / 'tools' / 'arch_baseline.json'
        self.documented_file = self.root / 'tools' / 'arch_documented_sudo.json'
        self.layers_file.parent.mkdir()
        self.layers = {'ranks': {'webvue_core': 0}, 'exempt': [], 'web_apps': {}, 'commercial': {'pages': {}, 'allowed': []}}
        self.layers_file.write_text(json.dumps(self.layers), encoding='utf-8')
        self.write('odoo-addons/webvue_core/__manifest__.py', HEADER + repr({'name': 'core', 'depends': ['base']}))
        self.sudo(1)
        self.baseline({'R7': {self.ADDON: 1}})
        self.document({})
        self.agents('`webvue_core`')

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def sudo(self, n):
        self.write(self.ADDON, sudo_text(n))

    def baseline(self, data):
        self.baseline_file.write_text(json.dumps(data), encoding='utf-8')

    def document(self, cases):
        self.documented_file.write_text(json.dumps({'cases': cases}), encoding='utf-8')

    def agents(self, tokens):
        self.write('AGENTS.md', f'# t\n\n- The `sudo()` cases are listed per file in `tools/arch_documented_sudo.json`; {tokens} has a documented path.\n')

    def problems(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stderr(out):
            code = self.run_main(*argv)
        return code, out.getvalue()

    def run_main(self, *argv):
        return main(list(argv), root=self.root, layers_file=self.layers_file, baseline_file=self.baseline_file,
                    documented_file=self.documented_file)

    def test_a_tree_at_its_allowance_passes(self):
        self.assertEqual(self.problems(), (0, ''))

    def test_a_new_sudo_in_an_undocumented_file_fails_by_file_and_line(self):
        self.sudo(2)
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.ADDON}:2: sudo() has no documented justification', text)
        self.assertIn('2 found, 1 allowed', text)
        self.assertIn('arch_documented_sudo.json or remove the call', text)

    def test_a_documented_case_covers_its_sites(self):
        self.sudo(3)
        self.document({self.ADDON: {'count': 2, 'reason': REASON}})
        self.assertEqual(self.problems(), (0, ''))

    def test_a_boilerplate_reason_fails(self):
        self.document({self.ADDON: {'count': 1, 'reason': 'required for the feature to work'}})
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn('not specific enough', text)

    def test_a_documented_case_must_be_described_in_agents_md(self):
        self.document({self.ADDON: {'count': 1, 'reason': REASON}})
        self.agents('`webvue_other`')
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn(f'R7: {self.ADDON}: documented case not described in AGENTS.md', text)

    def test_an_unregistered_addon_leaves_its_sites_unchecked(self):
        self.write('odoo-addons/webvue_new/__manifest__.py', HEADER + repr({'name': 'new', 'depends': ['base']}))
        self.write('odoo-addons/webvue_new/models/m.py', sudo_text(1))
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn('unregistered addon webvue_new', text)
        self.assertIn('its sudo() sites are unchecked', text)

    def test_a_file_below_its_allowance_is_not_this_gate_s_business(self):
        self.sudo(0)
        self.assertEqual(self.problems(), (0, ''))


class BaseRefCase(GateCase):
    """The same tree as a git repository, so `--base` can apply the documented-case trailer rule."""

    def setUp(self):
        super().setUp()
        self.git('init', '-q', '-b', 'main')
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'base')

    def git(self, *args):
        return subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *args],
            cwd=self.root, check=True, capture_output=True, text=True, shell=False,
        )

    def commit(self, message, *extra):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', message, *extra)


class TestDocumentedTrailer(BaseRefCase):
    """A new or raised documented case needs the owner trailer on the commit that changes the file."""

    def document_a_new_case(self):
        self.git('checkout', '-q', '-b', 'work')
        self.sudo(2)
        self.document({self.ADDON: {'count': 2, 'reason': REASON}})

    def test_a_new_case_passes_without_a_trailer(self):
        # Owner decision 2026-10-25: documenting a sudo case no longer needs a trailer.
        self.document_a_new_case()
        self.commit('document')
        self.assertEqual(self.problems('--base', 'main'), (0, ''))

    def test_a_documented_count_the_code_no_longer_reaches_fails(self):
        # The reason is still mandatory; only the trailer requirement was removed.
        self.document({self.ADDON: {'count': 2, 'reason': REASON}})
        code, text = self.problems()
        self.assertEqual(code, 1)
        self.assertIn('documented', text)

    def test_unchanged_tree_passes_with_a_base(self):
        self.assertEqual(self.problems('--base', 'main'), (0, ''))

    def test_unknown_ref_exits_two(self):
        self.assertEqual(self.run_main('--base', 'no-such-ref'), 2)

    def test_the_cli_reads_ci_base_ref_only_when_argv_is_absent(self):
        # npm test runs the command line, CI exports CI_BASE_REF for it; programmatic calls stay explicit.
        self.document_a_new_case()
        self.commit('document')
        self.assertEqual(self.problems(), (0, ''))


class TestRepository(unittest.TestCase):
    def test_repository_passes_the_gate(self):
        """The real tree with its documented cases and baseline; this is what `npm test` runs."""
        self.assertEqual(main([]), 0, 'run: python3 -B tools/sudo_gate.py')


if __name__ == '__main__':
    unittest.main()

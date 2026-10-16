# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Generated Odoo script content for branch/policy application (unit, no Odoo)."""
import ast
import unittest

from tools.shared_saas_lifecycle import subscription_effect as se
from tools.shared_saas_lifecycle.test_subscription_effect import B1, B2, DB, make_request


class ScriptContentTests(unittest.TestCase):
    def script(self):
        request = make_request(branches={'apply': [{'branch_id': B1, 'name': 'Riyadh'}], 'archive': [B2]})
        return se.build_apply_script(request)

    def test_valid_python(self):
        ast.parse(self.script())
        ast.parse(se.build_observe_script(DB))

    def test_operator_context_and_single_write(self):
        text = self.script()
        self.assertIn('OPERATOR_CONTEXT', text)
        self.assertEqual(text.count('.write('), 1)
        block = text[text.index('operator.write('):text.index('if values')]
        for field in ("'features'", "'commercial_revision_id'", "'commercial_digest'", "'commercial_applied_at'"):
            self.assertIn(field, block)
        self.assertIn('_webvue_apply_branches(values', text)
        self.assertIn('_webvue_archive_branch(values', text)
        self.assertLess(text.index('_webvue_archive_branch'), text.index('_webvue_apply_branches('))

    def test_no_sudo_no_uninstall_no_delete(self):
        for text in (self.script(), se.build_observe_script(DB)):
            for forbidden in ('sudo(', 'with_user', 'button_uninstall', 'module_uninstall', 'unlink(', 'DELETE', 'DROP', 'TRUNCATE'):
                self.assertNotIn(forbidden, text)

    def test_removed_module_flags_turned_off_not_uninstalled(self):
        text = self.script()
        self.assertIn("._webvue_close_unlisted_features(values['features'])", text)
        self.assertNotIn('button_uninstall', text)

    def test_observe_is_read_only(self):
        text = se.build_observe_script(DB)
        self.assertIn('SET TRANSACTION READ ONLY', text)
        self.assertNotIn('commit()', text)
        self.assertNotIn('.write(', text)

    def test_commit_once_after_success(self):
        text = self.script()
        self.assertEqual(text.count('env.cr.commit()'), 1)
        self.assertLess(text.index('env.cr.commit()'), text.index('except Refusal'))

    def test_values_are_data_not_code(self):
        name = "x'); import os #"
        request = make_request(branches={'apply': [{'branch_id': B1, 'name': name}], 'archive': []})
        text = se.build_apply_script(request)
        ns = {}
        exec(text.split('\n', 2)[0] + '\n' + text.split('\n', 2)[1], ns)
        self.assertEqual(ns['values']['apply'][0]['name'], name)
        self.assertNotIn('import os', [n.names[0].name for n in ast.walk(ast.parse(text)) if isinstance(n, ast.Import)])

    def test_database_guard(self):
        self.assertIn("env.cr.dbname != values['database']", self.script())
        with self.assertRaises(se.EffectError):
            se.build_observe_script('odoo19')


class RunnerPermitTests(unittest.TestCase):
    def test_rejects_unsafe_config(self):
        request = make_request()
        request['config'] = {'schemaVersion': 2}
        with self.assertRaises(se.EffectError):
            se.ComposeRunner(request)


if __name__ == '__main__':
    unittest.main()

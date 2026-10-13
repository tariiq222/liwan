# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Guards the shape of .woodpecker.yml's Odoo steps that are not the release install."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TestWoodpeckerOdooSteps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # No YAML parser: the static step runs on the bare host Python.
        text = (ROOT / '.woodpecker.yml').read_text().split('\nsteps:\n', 1)[1]
        cls.steps = {block.split('\n', 1)[0].strip(): block
                     for block in re.split(r'^  - name: ', text, flags=re.M)[1:]}

    def script(self, name):
        return self.steps[name]

    def test_tasks_steps_follow_the_odoo_step_in_order(self):
        names = list(self.steps)
        self.assertEqual(names.index('odoo-tasks-standalone'), names.index('odoo') + 1)
        self.assertEqual(names.index('odoo-tasks-bridge'), names.index('odoo') + 2)

    def test_standalone_installs_only_nasq_tasks_and_asserts_no_pmo(self):
        script = self.script('odoo-tasks-standalone')
        self.assertIn('MODULES="nasq_tasks"', script)
        self.assertIn('--test-tags "/nasq_tasks"', script)
        self.assertIn("name IN ('nasq_pmo', 'nasq_tasks_pmo') AND state = 'installed'", script)

    def test_bridge_installs_the_bridge_configuration_and_asserts_it_installed(self):
        script = self.script('odoo-tasks-bridge')
        self.assertIn('MODULES="nasq_tasks,nasq_pmo,nasq_tasks_pmo"', script)
        self.assertIn('--test-tags "/nasq_tasks,/nasq_tasks_pmo"', script)
        self.assertIn("name = 'nasq_tasks_pmo'", script)
        self.assertIn('test "$bridge_state" = installed', script)

    def test_tasks_steps_use_their_own_databases_and_ports(self):
        # The existing steps run one after another and share port 8169; the new ones must not join them.
        for pattern in (r'--http-port=(\d+)', r'SCRATCH_DB="([^"]+)"'):
            values = {name: re.search(pattern, self.script(name)).group(1)
                      for name in ('odoo', 'upgrade', 'odoo-tasks-standalone', 'odoo-tasks-bridge')}
            new = [values['odoo-tasks-standalone'], values['odoo-tasks-bridge']]
            self.assertEqual(len(set(new)), 2, values)
            self.assertFalse(set(new) & {values['odoo'], values['upgrade']}, values)

    def test_tasks_steps_clean_up_and_use_the_classification_fixture(self):
        for name in ('odoo-tasks-standalone', 'odoo-tasks-bridge'):
            script = self.script(name)
            self.assertIn('trap cleanup EXIT', script)
            self.assertIn('fixture --database "$SCRATCH_DB" --mode saas', script)
            self.assertIn('--stop-after-init', script)


if __name__ == '__main__':
    unittest.main()

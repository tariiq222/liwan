# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, new_test_user


class NasqApiCase(HttpCase):
    """Shared HTTP fixture: the base nasq employee role plus a JSON ``api()`` helper.

    Holds nothing pillar-specific — a pillar addon subclasses this and adds
    its own records (see ``nasq_pmo/tests/common.py``) so the pillars never
    write to this file.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='api_emp', password='api_emp_pass_123',
                                     name='Sara', groups='nasq_core.group_employee')

    def api(self, method, path, json=None, timeout=None):
        headers = {'Content-Type': 'application/json'}
        kwargs = {} if timeout is None else {'timeout': timeout}
        return self.url_open(path, json=json, headers=headers, method=method, **kwargs)

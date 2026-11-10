# Part of Odoo. See LICENSE file for full copyright and licensing details.
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import api_surface
from e2e_scenario_coverage import (
    TOKEN,
    page_route,
    referenced_tokens,
    report,
    routes_in_source,
)


CONTROLLER = Path('controller.py')


class TestScenarioCoverage(unittest.TestCase):
    def test_page_route_normalizes_params_and_index(self):
        self.assertEqual(page_route('hr/leave/[leaveId].vue'), '/hr/leave/[id]')
        self.assertEqual(page_route('hr/leave/index.vue'), '/hr/leave')
        self.assertEqual(page_route('index.vue'), '/')
        self.assertEqual(page_route('chat/[id]/[[panel]].vue'), '/chat/[id]/[[id]]')

    def test_routes_in_source_reads_paths_and_methods(self):
        source = (
            "class C:\n"
            "    @http.route('/api/v1/hr/leaves/<int:leave_id>/approve', type='json2', methods=['POST'])\n"
            "    def approve(self, leave_id):\n"
            "        pass\n"
            "    @http.route(['/api/v1/a', '/api/v1/b'], type='json2', methods=['GET', 'PATCH'])\n"
            "    def both(self):\n"
            "        pass\n"
        )
        self.assertEqual(routes_in_source(source, CONTROLLER), {
            'POST /api/v1/hr/leaves/<id>/approve',
            'GET /api/v1/a', 'PATCH /api/v1/a', 'GET /api/v1/b', 'PATCH /api/v1/b',
        })

    def test_routes_in_source_resolves_constants_and_fstrings(self):
        source = (
            "RUN = '/api/v1/runs/<int:run_id>'\n"
            "class C:\n"
            "    @http.route(f'{RUN}/file', methods=['POST'])\n"
            "    def file(self, run_id):\n"
            "        pass\n"
            "    @http.route(RUN, methods=['GET'])\n"
            "    def get(self, run_id):\n"
            "        pass\n"
            "    @http.route(RUN + '/slots', methods=['GET'])\n"
            "    def slots(self, run_id):\n"
            "        pass\n"
        )
        self.assertEqual(
            routes_in_source(source, CONTROLLER),
            {'POST /api/v1/runs/<id>/file', 'GET /api/v1/runs/<id>', 'GET /api/v1/runs/<id>/slots'},
        )

    def test_routes_in_source_refuses_an_unreadable_path(self):
        source = "class C:\n    @http.route(make_path(), methods=['GET'])\n    def get(self):\n        pass\n"
        with self.assertRaises(ValueError):
            routes_in_source(source, CONTROLLER)

    def test_routes_in_source_resolves_an_imported_constant(self):
        source = (
            "from odoo.addons.liwan_demo.models.usage import USAGE_PATH\n"
            "class C:\n"
            "    @http.route(USAGE_PATH, methods=['POST'])\n"
            "    def usage(self):\n"
            "        pass\n"
        )
        with tempfile.TemporaryDirectory() as folder:
            models = Path(folder, 'liwan_demo', 'models')
            models.mkdir(parents=True)
            (models / 'usage.py').write_text("USAGE_PATH = '/api/v1/demo/usage'\n", encoding='utf-8')
            with mock.patch.object(api_surface, 'ADDONS', Path(folder)):
                self.assertEqual(routes_in_source(source, CONTROLLER), {'POST /api/v1/demo/usage'})

    def test_routes_in_source_refuses_an_unresolvable_imported_path(self):
        source = (
            "from odoo.addons.liwan_demo.models.missing import USAGE_PATH\n"
            "class C:\n"
            "    @http.route(USAGE_PATH, methods=['POST'])\n"
            "    def usage(self):\n"
            "        pass\n"
        )
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(api_surface, 'ADDONS', Path(folder)):
            with self.assertRaises(ValueError):
                routes_in_source(source, CONTROLLER)

    def test_token_pattern_finds_every_kind(self):
        text = '| x | `page /hr` `vendor /plans` `GET /api/v1/hr/me` `cap hr.leave.read` `other` |'
        self.assertEqual(TOKEN.findall(text), ['page /hr', 'vendor /plans', 'GET /api/v1/hr/me', 'cap hr.leave.read'])

    def test_referenced_page_tokens_ignore_parameter_names(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'pay.md').write_text('| `page /pay/[kind]/[id]` `GET /api/v1/x/<int:id>` |', encoding='utf-8')
            self.assertEqual(referenced_tokens(Path(folder)), {'page /pay/[id]/[id]', 'GET /api/v1/x/<int:id>'})

    def test_report_lists_missing_and_unknown(self):
        groups = {'liwan_hr': {'GET /api/v1/hr/me', 'POST /api/v1/hr/x'}}
        missing, unknown = report(groups, {'GET /api/v1/hr/me', 'GET /api/v1/gone'})
        self.assertEqual(missing, {'liwan_hr': ['POST /api/v1/hr/x']})
        self.assertEqual(unknown, ['GET /api/v1/gone'])


if __name__ == '__main__':
    unittest.main()

# Part of Odoo. See LICENSE file for full copyright and licensing details.
import ast
import unittest

import api_surface
import route_gate_policy

SOURCE = '''
class Probe:
    @route('/a', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('a.enabled', 'b.enabled', operation='read', match='any')
    def static_gate(self):
        return None

    @route('/b', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('webvue.example', '_keys', keys=('registry:webvue.example',), operation='read')
    def registered_gate(self):
        return None

    @route('/c', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def row_level(self):
        return None
'''


class TestFeatureMetadata(unittest.TestCase):

    def test_both_gates_document_their_keys_and_operation(self):
        functions = {node.name: node for node in ast.walk(ast.parse(SOURCE)) if isinstance(node, ast.FunctionDef)}
        self.assertEqual(api_surface.feature_metadata(functions['static_gate']), (['a.enabled', 'b.enabled'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['registered_gate']), (['registry:webvue.example'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['row_level']), ([], None))


class TestCapabilityMatrix(unittest.TestCase):

    def test_matrix_lists_keys_and_reasons_per_operation(self):
        path = route_gate_policy.ADDONS / 'webvue_hr' / 'controllers' / 'probe.py'
        source = (
            "class P:\n"
            "    @route('/api/v1/a/<int:rid>', type='json2', auth='user', methods=['GET', 'POST'])\n"
            "    @api_handler\n    @requires_feature('hr.enabled')\n"
            "    @requires_capability('hr.read', 'hr.write', match='any')\n"
            "    def gated(self): pass\n"
            "    @route('/api/v1/b', type='json2', auth='user', methods=['GET'])\n"
            "    @api_handler\n    @requires_feature('hr.enabled')\n"
            "    def open_route(self): pass\n"
        )
        trees = {path: ast.parse(source)}
        routes = route_gate_policy.extract_routes(trees, {})
        allow = {'no_capability': {'webvue_hr/controllers/probe.py:open_route': 'own data only'}}
        operations = api_surface.capability_matrix(routes, allow)['operations']
        self.assertEqual(list(operations), ['GET /api/v1/a/{rid}', 'POST /api/v1/a/{rid}', 'GET /api/v1/b'])
        gated = operations['GET /api/v1/a/{rid}']
        self.assertEqual((gated['capability_source'], gated['capability_keys'], gated['capability_match']),
                         ('decorator', ['hr.read', 'hr.write'], 'any'))
        self.assertEqual(gated['feature_keys'], ['hr.enabled'])
        open_route = operations['GET /api/v1/b']
        self.assertEqual((open_route['capability_source'], open_route['no_capability_reason']), ('none', 'own data only'))


if __name__ == '__main__':
    unittest.main()

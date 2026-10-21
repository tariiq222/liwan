# Part of Odoo. See LICENSE file for full copyright and licensing details.
import ast
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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


class TestRoutePathResolution(unittest.TestCase):
    """A route path may be a literal, a module constant or an f-string over constants; nothing is dropped silently."""

    SOURCE = (
        "PREFIX = '/api/v1/x'\n"
        "OTHER = '/api/v1/y'\n"
        "class P:\n"
        "    @route('/api/v1/lit', type='json2', auth='user', methods=['GET'])\n"
        "    def literal(self): pass\n"
        "    @route(PREFIX, type='json2', auth='user', methods=['GET'])\n"
        "    def constant(self): pass\n"
        "    @route(f'{PREFIX}/<int:rid>/go', type='json2', auth='user', methods=['POST'])\n"
        "    def fstring(self): pass\n"
        "    @route(OTHER + '/z', type='json2', auth='user', methods=['GET'])\n"
        "    def concatenated(self): pass\n"
    )

    def paths(self, source):
        path = route_gate_policy.ADDONS / 'webvue_hr' / 'controllers' / 'probe.py'
        return {r['handler']: r['paths'] for r in api_surface.extract_routes({path: ast.parse(source)})}

    def test_literal_constant_fstring_and_concatenation_resolve(self):
        self.assertEqual(self.paths(self.SOURCE), {
            'literal': ['/api/v1/lit'],
            'constant': ['/api/v1/x'],
            'fstring': ['/api/v1/x/<int:rid>/go'],
            'concatenated': ['/api/v1/y/z'],
        })

    def test_an_unresolvable_path_stops_the_generator_instead_of_vanishing(self):
        source = "class P:\n    @route(f'{unknown}/a', type='json2', auth='user')\n    def lost(self): pass\n"
        with self.assertRaises(SystemExit) as raised:
            self.paths(source)
        self.assertIn('lost', str(raised.exception))


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


class NestedPackageTests(unittest.TestCase):
    """A controller module inside a nested area package (spec §8.7) is parsed like a flat one."""

    NESTED = api_surface.ADDONS / 'webvue_hr' / 'controllers' / 'shifts' / 'probe.py'

    def test_parse_controllers_scans_every_depth_once_in_a_stable_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'odoo-addons'
            (root / 'webvue_hr' / 'controllers' / 'shifts').mkdir(parents=True)
            (root / 'webvue_hr' / 'controllers' / 'flat.py').write_text('x = 1\n')
            (root / 'webvue_hr' / 'controllers' / '__init__.py').write_text('from . import flat\n')
            (root / 'webvue_hr' / 'controllers' / 'shifts' / 'deep.py').write_text('x = 1\n')
            (root / 'webvue_hr' / 'controllers' / 'shifts' / '__init__.py').write_text('from . import deep\n')
            with mock.patch.object(api_surface, 'ADDONS', root):
                trees = api_surface.parse_controllers()
            keys = [str(path.relative_to(root)) for path in trees]
        # Both depths are parsed and every __init__.py (which only imports) is skipped.
        self.assertEqual(keys, ['webvue_hr/controllers/flat.py', 'webvue_hr/controllers/shifts/deep.py'])
        self.assertEqual(len(keys), len(set(keys)))

    def test_a_nested_module_reports_its_owning_addon_and_repo_path(self):
        raw = api_surface.extract_routes({self.NESTED: ast.parse(SOURCE)})
        self.assertEqual([item['handler'] for item in raw], ['static_gate', 'registered_gate', 'row_level'])
        self.assertEqual({item['addon'] for item in raw}, {'webvue_hr'})
        self.assertEqual(
            {item['file'] for item in raw},
            {'odoo-addons/webvue_hr/controllers/shifts/probe.py'},
        )


if __name__ == '__main__':
    unittest.main()

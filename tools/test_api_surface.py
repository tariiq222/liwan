# Part of Odoo. See LICENSE file for full copyright and licensing details.
import ast
import unittest

import api_surface

SOURCE = '''
class Probe:
    @route('/a', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('a.enabled', 'b.enabled', operation='read', match='any')
    def static_gate(self):
        return None

    @route('/b', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('nasq.example', '_keys', keys=('registry:nasq.example',), operation='read')
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
        self.assertEqual(api_surface.feature_metadata(functions['registered_gate']), (['registry:nasq.example'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['row_level']), ([], None))


if __name__ == '__main__':
    unittest.main()

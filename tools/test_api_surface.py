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
    @requires_registered_feature('liwan.example', '_keys', keys=('registry:liwan.example',), operation='read')
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
        self.assertEqual(api_surface.feature_metadata(functions['registered_gate']), (['registry:liwan.example'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['row_level']), ([], None))

    def test_a_key_written_as_a_constant_resolves_to_the_gate_the_controller_sets(self):
        """Issue #470: the documented key must equal the gate, however the decorator spells it."""
        source = (
            "FEATURE = 'payments.enabled'\n"
            "FEATURES = ('crm.enabled', 'crm.import')\n"
            "class P:\n"
            "    @requires_feature(FEATURE, operation='read')\n"
            "    def named(self): pass\n"
            "    @requires_feature(*FEATURES, operation='write')\n"
            "    def spread(self): pass\n"
            "    @requires_feature(FEATURE, 'literal.enabled')\n"
            "    def mixed(self): pass\n"
        )
        tree = ast.parse(source)
        functions = {node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}
        constants = api_surface.resolvable_constants(Path('probe.py'), tree)
        self.assertEqual(api_surface.feature_metadata(functions['named'], constants), (['payments.enabled'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['spread'], constants),
                         (['crm.enabled', 'crm.import'], 'write'))
        self.assertEqual(api_surface.feature_metadata(functions['mixed'], constants),
                         (['payments.enabled', 'literal.enabled'], None))

    def test_a_key_imported_from_another_module_resolves(self):
        """``from ...models.access_service import ORDERS_READ`` names a real capability, not an empty key."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'models').mkdir()
            (root / 'models' / 'access_service.py').write_text("ORDERS_READ = 'payments.orders.read'\n")
            controller = root / 'controllers.py'
            controller.write_text(
                "from .models.access_service import ORDERS_READ\n"
                "class P:\n"
                "    @requires_capability(ORDERS_READ)\n"
                "    def list_orders(self): pass\n"
            )
            tree = ast.parse(controller.read_text())
            constants = api_surface.resolvable_constants(controller, tree)
            self.assertEqual(constants.get('ORDERS_READ'), 'payments.orders.read')
            decorator = next(
                node for node in ast.walk(tree)
                if isinstance(node, ast.Call) and api_surface.decorator_name(node) == 'requires_capability'
            )
            self.assertEqual(api_surface.const_strings(decorator.args[0], constants), ['payments.orders.read'])

    def test_an_imported_constant_keeps_its_local_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'models').mkdir()
            (root / 'models' / 'access_service.py').write_text("ORDERS_READ = 'payments.orders.read'\n")
            controller = root / 'controllers.py'
            controller.write_text("from .models.access_service import ORDERS_READ as READ_ORDERS\n")
            constants = api_surface.resolvable_constants(controller, ast.parse(controller.read_text()))
            self.assertEqual(constants.get('READ_ORDERS'), 'payments.orders.read')

    def test_an_unresolvable_key_is_reported_not_silently_empty(self):
        """A name that is not a constant stays out of the list; the route therefore fails the policy gate."""
        tree = ast.parse("class P:\n    @requires_feature(UNDEFINED, operation='read')\n    def r(self): pass\n")
        functions = {node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}
        self.assertEqual(api_surface.feature_metadata(functions['r'], {}), ([], 'read'))


class TestHelperCapabilityKeys(unittest.TestCase):
    """A route gated through a helper publishes the key the helper enforces, and nothing from another app.

    Review of issue #470: the archive helpers exist on several models, so an untyped receiver used
    to publish HR's archive capability under a project route. These tests pin both halves: the
    receiver's own reader call supplies a precise key, and an untypable receiver supplies none.
    """

    def routes(self, source, models=None):
        path = route_gate_policy.ADDONS / 'liwan_hr' / 'controllers' / 'probe_keys.py'
        trees = {path: ast.parse(source)}
        return {r.handler: r for r in route_gate_policy.extract_routes(trees, models or {})}

    def test_a_gate_through_a_helper_publishes_the_helpers_own_reader_key(self):
        source = (
            "class P:\n"
            "    @route('/api/v1/a', type='json2', auth='user', methods=['POST'], readonly=False)\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled')\n"
            "    def archive_thing(self):\n"
            "        record = get_visible_record('project.project', 1)\n"
            "        return record._liwan_archive()\n"
        )
        models = {route_gate_policy.ADDONS / 'liwan_pmo' / 'models' / 'project_project.py': ast.parse(
            "class Project:\n"
            "    _name = 'project.project'\n"
            "    def _liwan_archive(self):\n"
            "        self._liwan_check_manage()\n"
            "    def _liwan_check_manage(self):\n"
            "        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.projects.manage'):\n"
            "            raise AccessError('no')\n"
        )}
        route = self.routes(source, models)['archive_thing']
        self.assertTrue(route.has_capability)
        self.assertEqual(route.capability_keys, ['pmo.projects.manage'])

    def test_an_untypable_receiver_contributes_no_key_from_another_application(self):
        source = (
            "class P:\n"
            "    @route('/api/v1/b', type='json2', auth='user', methods=['POST'], readonly=False)\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled')\n"
            "    def archive_thing(self):\n"
            "        return make_record()._liwan_archive()\n"
        )
        models = {route_gate_policy.ADDONS / 'liwan_hr' / 'models' / 'hr_employee.py': ast.parse(
            "class Employee:\n"
            "    _name = 'hr.employee'\n"
            "    def _liwan_archive(self):\n"
            "        self.env['liwan.access.service']._liwan_require_capability('hr.employees.archive')\n"
        )}
        route = self.routes(source, models)['archive_thing']
        self.assertTrue(route.has_capability, 'the helper still counts as a gate')
        self.assertEqual(route.capability_keys, [], 'but its key is not this route\'s requirement')

    def test_a_state_argument_is_never_published_as_a_capability(self):
        """``_liwan_transition(DONE_STATE)`` passes a task state, not a capability."""
        source = (
            "class P:\n"
            "    @route('/api/v1/c', type='json2', auth='user', methods=['POST'], readonly=False)\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled')\n"
            "    def accept(self, task_id):\n"
            "        task = get_visible_record('project.task', task_id)\n"
            "        return task._liwan_accept_completion()\n"
        )
        models = {route_gate_policy.ADDONS / 'liwan_pmo' / 'models' / 'task_completion.py': ast.parse(
            "DONE_STATE = '1_done'\n"
            "class Task:\n"
            "    _name = 'project.task'\n"
            "    def _liwan_accept_completion(self):\n"
            "        self._liwan_transition(DONE_STATE)\n"
            "    def _liwan_transition(self, state):\n"
            "        self._liwan_check_transition_allowed(state)\n"
            "        return self\n"
            "    def _liwan_check_transition_allowed(self, state):\n"
            "        if not self._liwan_can_approve():\n"
            "            raise AccessError('no')\n"
            "    def _liwan_can_approve(self):\n"
            "        return self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.tasks.approve')\n"
        )}
        route = self.routes(source, models)['accept']
        self.assertNotIn('1_done', route.capability_keys)
        self.assertEqual(route.capability_keys, ['pmo.tasks.approve'])

    def test_a_wrapper_names_its_key_at_the_call_site(self):
        """``convert._require('tasks.tasks.read')`` forwards its argument to the reader."""
        source = (
            "class P:\n"
            "    @route('/api/v1/d', type='json2', auth='user', methods=['GET'], readonly=True)\n"
            "    @api_handler\n"
            "    @requires_feature('tasks.enabled')\n"
            "    def targets(self):\n"
            "        convert = request.env['liwan.my.task.convert']\n"
            "        convert._require('tasks.tasks.read')\n"
            "        return {'items': []}\n"
        )
        models = {route_gate_policy.ADDONS / 'liwan_tasks_pmo' / 'models' / 'task_convert.py': ast.parse(
            "class Convert:\n"
            "    _name = 'liwan.my.task.convert'\n"
            "    def _require(self, key):\n"
            "        if not self._has_capability(key):\n"
            "            raise ApiError(403, 'forbidden')\n"
        )}
        route = self.routes(source, models)['targets']
        self.assertEqual(route.capability_keys, ['tasks.tasks.read'])

    def test_a_capability_from_a_conditional_branch_is_not_published(self):
        """``if state in MANAGER_STATES and not can_approve(): raise`` is not the route's rule."""
        source = (
            "class P:\n"
            "    @route('/api/v1/e', type='json2', auth='user', methods=['POST'], readonly=False)\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled')\n"
            "    def transition(self, task_id):\n"
            "        task = get_visible_record('project.task', task_id)\n"
            "        return task._liwan_transition(DONE_STATE)\n"
        )
        models = {route_gate_policy.ADDONS / 'liwan_pmo' / 'models' / 'task_transitions.py': ast.parse(
            "MANAGER_STATES = ('03_approved',)\n"
            "DONE_STATE = '1_done'\n"
            "class Task:\n"
            "    _name = 'project.task'\n"
            "    def _liwan_transition(self, state):\n"
            "        self._liwan_check_transition_allowed(state)\n"
            "    def _liwan_check_transition_allowed(self, state):\n"
            "        if state in MANAGER_STATES and not self._liwan_can_approve():\n"
            "            raise AccessError('no')\n"
            "    def _liwan_can_approve(self):\n"
            "        return self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.tasks.approve')\n"
        )}
        route = self.routes(source, models)['transition']
        self.assertTrue(route.has_capability, 'the refusal still counts as a gate')
        self.assertEqual(route.capability_keys, [], 'a state-conditional check is not the route requirement')

    def test_a_helper_with_two_implementations_publishes_no_conjunctive_key(self):
        """Two addons overrode ``_liwan_can_write`` with different keys; the route needs one, not both."""
        source = (
            "class P:\n"
            "    @route('/api/v1/f', type='json2', auth='user', methods=['PATCH'], readonly=False)\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled')\n"
            "    def patch_task(self, task_id):\n"
            "        task = get_visible_record('project.task', task_id)\n"
            "        task._liwan_check_write()\n"
            "        return {'ok': True}\n"
        )
        models = {
            route_gate_policy.ADDONS / 'liwan_pmo' / 'models' / 'project_task.py': ast.parse(
                "class Task:\n"
                "    _name = 'project.task'\n"
                "    def _liwan_check_write(self):\n"
                "        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.tasks.write'):\n"
                "            raise AccessError('no')\n"
            ),
            route_gate_policy.ADDONS / 'liwan_tasks_pmo' / 'models' / 'project_task_personal.py': ast.parse(
                "class TaskPersonal:\n"
                "    _inherit = 'project.task'\n"
                "    def _liwan_check_write(self):\n"
                "        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'tasks.tasks.write'):\n"
                "            raise AccessError('no')\n"
            ),
        }
        route = self.routes(source, models)['patch_task']
        self.assertTrue(route.has_capability)
        self.assertEqual(route.capability_keys, [], 'neither key alone is the requirement')


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
        path = route_gate_policy.ADDONS / 'liwan_hr' / 'controllers' / 'probe.py'
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
        path = route_gate_policy.ADDONS / 'liwan_hr' / 'controllers' / 'probe.py'
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
        allow = {'no_capability': {'liwan_hr/controllers/probe.py:open_route': 'own data only'}}
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

    NESTED = api_surface.ADDONS / 'liwan_hr' / 'controllers' / 'shifts' / 'probe.py'

    def test_parse_controllers_scans_every_depth_once_in_a_stable_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'odoo-addons'
            (root / 'liwan_hr' / 'controllers' / 'shifts').mkdir(parents=True)
            (root / 'liwan_hr' / 'controllers' / 'flat.py').write_text('x = 1\n')
            (root / 'liwan_hr' / 'controllers' / '__init__.py').write_text('from . import flat\n')
            (root / 'liwan_hr' / 'controllers' / 'shifts' / 'deep.py').write_text('x = 1\n')
            (root / 'liwan_hr' / 'controllers' / 'shifts' / '__init__.py').write_text('from . import deep\n')
            with mock.patch.object(api_surface, 'ADDONS', root):
                trees = api_surface.parse_controllers()
            keys = [str(path.relative_to(root)) for path in trees]
        # Both depths are parsed and every __init__.py (which only imports) is skipped.
        self.assertEqual(keys, ['liwan_hr/controllers/flat.py', 'liwan_hr/controllers/shifts/deep.py'])
        self.assertEqual(len(keys), len(set(keys)))

    def test_a_nested_module_reports_its_owning_addon_and_repo_path(self):
        raw = api_surface.extract_routes({self.NESTED: ast.parse(SOURCE)})
        self.assertEqual([item['handler'] for item in raw], ['static_gate', 'registered_gate', 'row_level'])
        self.assertEqual({item['addon'] for item in raw}, {'liwan_hr'})
        self.assertEqual(
            {item['file'] for item in raw},
            {'odoo-addons/liwan_hr/controllers/shifts/probe.py'},
        )


if __name__ == '__main__':
    unittest.main()

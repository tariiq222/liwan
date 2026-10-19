# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tests for tools/route_gate_policy.py."""
import ast
import unittest
from pathlib import Path

import route_gate_policy as policy

FAKE = policy.ADDONS / 'webvue_hr' / 'controllers' / 'sample.py'  # rank 4 application addon
MODEL = policy.ADDONS / 'webvue_hr' / 'models' / 'sample_model.py'
FOUNDATION = policy.ADDONS / 'webvue_api' / 'controllers' / 'sample.py'  # rank 2 foundation


def routes_of(source: str, path: Path = FAKE, models: str = '') -> list[policy.Route]:
    services = {MODEL: ast.parse(models)} if models else {}
    return policy.extract_routes({path: ast.parse(source)}, services)


def only(source: str, path: Path = FAKE, models: str = '') -> policy.Route:
    routes = routes_of(source, path, models)
    assert len(routes) == 1, routes
    return routes[0]


ROUTE = "    @http.route('/api/v1/x', type='json2', auth='user', methods=['GET'])\n    @api_handler\n    @requires_feature('hr.enabled')\n"
HEAD = "class C:\n" + ROUTE


def handler(body: str, helpers: str = '', decorators: str = '') -> str:
    """A controller module whose route handler ``f`` has the given body."""
    return helpers + HEAD + decorators + "    def f(self):\n" + ''.join(f'        {line}\n' for line in body.splitlines())


NO_ALLOW = {group: {} for group in policy.GROUPS}


class DecoratorTests(unittest.TestCase):
    def test_decorator_is_a_capability_gate_with_its_keys(self):
        route = only(HEAD + "    @requires_capability('a.b', 'c.d', match='any')\n    def f(self): pass\n")
        self.assertEqual((route.capability_source, route.capability_keys, route.capability_match),
                         ('decorator', ['a.b', 'c.d'], 'any'))

    def test_decorator_defaults_to_all(self):
        route = only(HEAD + "    @requires_capability('a.b')\n    def f(self): pass\n")
        self.assertEqual(route.capability_match, 'all')

    def test_registered_feature_counts_as_a_feature_gate(self):
        source = (
            "class C:\n    @http.route('/api/v1/x', type='json2', auth='user')\n    @api_handler\n"
            "    @requires_registered_feature('m', 'k', keys=('a.enabled',))\n"
            "    @requires_capability('a.read')\n    def f(self): pass\n"
        )
        route = only(source)
        self.assertEqual((route.has_feature, route.feature_keys), (True, ['a.enabled']))
        self.assertEqual(policy.route_problems([route], NO_ALLOW), [])


class TopLevelCheckTests(unittest.TestCase):
    """Finding 2: only top-level statements before the handler returns data are gates."""

    def test_a_primitive_call_at_top_level_is_a_gate_with_its_keys(self):
        route = only(handler("require_capability('hr.read')\nreturn 1"))
        self.assertEqual((route.capability_source, route.capability_keys), ('body', ['hr.read']))

    def test_service_method_and_any_variant_count(self):
        self.assertTrue(only(handler("service._webvue_require_capability('a.b')")).has_capability)
        route = only(handler("require_any_capability(['a', 'b'])"))
        self.assertEqual(route.capability_match, 'any')

    def test_a_check_inside_an_if_branch_does_not_count(self):
        self.assertFalse(only(handler("if flag:\n    require_capability('hr.read')")).has_capability)

    def test_a_check_after_the_return_does_not_count(self):
        self.assertFalse(only(handler("return 1\nrequire_capability('hr.read')")).has_capability)

    def test_a_try_body_counts_but_its_handlers_do_not(self):
        self.assertTrue(only(handler("try:\n    require_capability('hr.read')\nexcept ValueError:\n    pass")).has_capability)
        self.assertFalse(only(handler("try:\n    pass\nexcept ValueError:\n    require_capability('hr.read')")).has_capability)

    def test_a_check_inside_a_nested_call_argument_counts_but_not_under_a_conditional_expression(self):
        helpers = "def guard():\n    require_capability('hr.read')\n"
        self.assertTrue(only(handler("return dump(guard())", helpers)).has_capability)
        self.assertFalse(only(handler("return dump(guard() if flag else None)", helpers)).has_capability)
        self.assertFalse(only(handler("return flag and guard()", helpers)).has_capability)

    def test_a_helper_counts_when_its_own_check_is_top_level(self):
        helpers = "def guard():\n    require_capability('hr.read')\n"
        self.assertTrue(only(handler("guard()\nreturn 1", helpers)).has_capability)

    def test_a_helper_does_not_count_when_its_check_is_conditional(self):
        helpers = "def guard(operator=False):\n    if not operator:\n        require_capability('hr.read')\n"
        self.assertFalse(only(handler("guard()\nreturn 1", helpers)).has_capability)

    def test_a_helper_call_inside_a_branch_of_the_handler_does_not_count(self):
        helpers = "def guard():\n    require_capability('hr.read')\n"
        self.assertFalse(only(handler("if flag:\n    guard()", helpers)).has_capability)

    def test_helpers_chain_through_top_level_calls(self):
        helpers = "def inner():\n    require_capability('hr.read')\ndef outer():\n    inner()\n"
        self.assertTrue(only(handler("outer()", helpers)).has_capability)

    def test_recursion_earns_no_credit(self):
        helpers = "def a():\n    b()\ndef b():\n    a()\n"
        self.assertFalse(only(handler("a()", helpers)).has_capability)


class ReaderTests(unittest.TestCase):
    """Finding 1: a reader counts only as the test of an if / assert that refuses."""

    def test_if_not_reader_raising_403_counts_with_the_reader_keys(self):
        route = only(handler("if not svc._webvue_has_capability(u, 'hr.read'):\n    raise ApiError(403, 'forbidden', 'no')"))
        self.assertEqual((route.capability_source, route.capability_keys), ('body', ['hr.read']))

    def test_access_error_and_a_require_helper_count_as_refusals(self):
        self.assertTrue(only(handler("if not svc._webvue_has_capability(u, 'a'):\n    raise AccessError('no')")).has_capability)
        self.assertTrue(only(handler("if not svc._webvue_has_capability(u, 'a'):\n    require_state(x)")).has_capability)

    def test_assert_on_a_reader_counts(self):
        self.assertTrue(only(handler("assert svc._webvue_has_capability(u, 'a')")).has_capability)

    def test_webvue_can_names_are_readers(self):
        self.assertTrue(only(handler("if not project._webvue_can_manage():\n    raise AccessError('no')")).has_capability)

    def test_reading_a_capability_without_refusing_is_not_a_gate(self):
        self.assertFalse(only(handler("return svc._webvue_has_capability(u, 'a')")).has_capability)
        self.assertFalse(only(handler("allowed = svc._webvue_has_capability(u, 'a')\nreturn allowed")).has_capability)

    def test_an_unrelated_raise_does_not_help(self):
        source = handler("ok = svc._webvue_has_capability(u, 'a')\nif bad:\n    raise ApiError(422, 'invalid', 'x')\nreturn ok")
        self.assertFalse(only(source).has_capability)

    def test_a_refusal_that_is_not_a_403_does_not_count(self):
        self.assertFalse(only(handler("if not svc._webvue_has_capability(u, 'a'):\n    raise ApiError(404, 'nf', 'x')")).has_capability)

    def test_an_if_that_only_returns_on_a_reader_does_not_count(self):
        self.assertFalse(only(handler("if not svc._webvue_has_capability(u, 'a'):\n    return []")).has_capability)

    def test_a_local_function_that_calls_a_reader_is_a_reader(self):
        helpers = "def _can(cap):\n    return svc._webvue_has_capability(u, cap)\n"
        self.assertTrue(only(handler("if not _can('hr.read'):\n    raise ApiError(403, 'forbidden', 'no')", helpers)).has_capability)


class ReceiverTests(unittest.TestCase):
    """Finding 3: a method call earns credit only through its receiver."""

    MODELS = (
        "class Project:\n    _inherit = 'project.project'\n"
        "    def _webvue_guard(self):\n        require_capability('pmo.projects.manage')\n"
        "    def plain(self):\n        require_capability('pmo.projects.manage')\n"
        "class Other:\n    _name = 'other.model'\n"
        "    def plain(self):\n        return 1\n"
        "    def action_do(self):\n        require_capability('x')\n"
        "    def check_access(self, op):\n        require_capability('x')\n"
        "    def _read(self):\n        require_capability('x')\n"
    )

    def route(self, body, models=None):
        return only(handler(body), models=self.MODELS if models is None else models)

    def test_a_record_of_a_model_literal_resolves_to_its_webvue_class(self):
        self.assertTrue(self.route("project = get_record('project.project', 1)\nproject.plain()").has_capability)
        self.assertTrue(self.route("request.env['project.project'].plain()").has_capability)
        self.assertTrue(self.route("P = request.env['project.project'].sudo()\nP.plain()").has_capability)

    def test_a_namesake_on_another_model_gives_no_credit(self):
        self.assertFalse(self.route("request.env['other.model'].plain()").has_capability)
        self.assertFalse(self.route("rec = get_record('other.model', 1)\nrec.plain()").has_capability)

    def test_an_unknown_receiver_gets_no_credit_by_a_plain_name(self):
        self.assertFalse(self.route("something.plain()").has_capability)

    def test_an_unknown_receiver_resolves_webvue_prefixed_names_when_any_definition_gates(self):
        self.assertTrue(self.route("record._webvue_guard()").has_capability)

    def test_stock_names_never_count(self):
        for call in ("request.env['other.model'].action_do()", "request.env['other.model'].check_access('read')",
                     "request.env['other.model']._read()", "request.env['other.model'].set_values({})"):
            self.assertFalse(self.route(call).has_capability, call)

    def test_self_resolves_to_the_controller_class_even_for_a_stock_looking_name(self):
        source = (
            "class C:\n    def _read(self):\n        require_capability('a')\n" + ROUTE +
            "    def f(self):\n        self._read()\n"
        )
        self.assertTrue(only(source).has_capability)

    def test_self_prefers_the_controllers_own_method_over_a_namesake(self):
        source = (
            "class Other:\n    def step(self):\n        pass\n"
            "class C:\n    def step(self):\n        require_capability('a')\n" + ROUTE +
            "    def f(self):\n        self.step()\n"
        )
        self.assertTrue(only(source).has_capability)


class OrderTests(unittest.TestCase):
    """Finding 4: route, api_handler, requires_feature*, requires_capability."""

    @staticmethod
    def with_decorators(*names):
        lines = ["class C:\n", "    @http.route('/api/v1/x', type='json2', auth='user')\n"]
        lines += [f"    @{name}\n" for name in names]
        lines.append("    def f(self): pass\n")
        return only(''.join(lines))

    def test_the_documented_order_passes(self):
        route = self.with_decorators('api_handler', "requires_feature('a')", "requires_capability('a')")
        self.assertIsNone(policy.order_problem(route))

    def test_capability_above_api_handler_or_the_feature_gate_fails(self):
        for names in (("requires_capability('a')", 'api_handler', "requires_feature('a')"),
                      ('api_handler', "requires_capability('a')", "requires_feature('a')"),
                      ("requires_feature('a')", 'api_handler', "requires_capability('a')")):
            route = self.with_decorators(*names)
            self.assertIn('out of order', policy.order_problem(route) or '', names)
            self.assertTrue(any('out of order' in p for p in policy.route_problems([route], NO_ALLOW)))

    def test_unlisted_decorators_are_unconstrained(self):
        route = self.with_decorators('api_handler', 'functools.cache', "requires_feature('a')", "requires_capability('a')")
        self.assertIsNone(policy.order_problem(route))


class RouteTests(unittest.TestCase):
    def test_a_bare_route_misses_every_gate(self):
        route = only("class C:\n    @http.route('/api/v1/x', type='json2', auth='user')\n    def f(self): pass\n")
        self.assertEqual((route.api_handler, route.has_feature, route.has_capability), (False, False, False))
        self.assertEqual(len(policy.route_problems([route], NO_ALLOW)), 3)

    def test_foundation_routes_need_no_feature_and_http_routes_no_api_handler(self):
        source = "class C:\n    @http.route('/api/v1/x', type='http', auth='user')\n    @requires_capability('a.read')\n    def f(self): pass\n"
        self.assertEqual(policy.route_problems([only(source, FOUNDATION)], NO_ALLOW), [])

    def test_only_api_v1_routes_are_checked(self):
        self.assertEqual(routes_of("class C:\n    @http.route('/web/x', type='http')\n    def f(self): pass\n"), [])

    def test_the_extraction_is_the_one_api_surface_reads(self):
        raw = policy.api_surface.extract_routes({FAKE: ast.parse(HEAD + "    def f(self): pass\n")})
        self.assertEqual((raw[0]['handler'], raw[0]['decorators']), ('f', ['route', 'api_handler', 'requires_feature']))


class AllowlistTests(unittest.TestCase):
    def test_allowlist_covers_a_route_and_a_stale_entry_is_an_error(self):
        route = only(HEAD + "    def f(self): pass\n")
        allow = {**NO_ALLOW, 'no_capability': {route.key: 'because'}}
        self.assertEqual(policy.route_problems([route], allow), [])
        stale = {**NO_ALLOW, 'no_capability': {'webvue_hr/controllers/sample.py:gone': 'because'}}
        self.assertIn('no such route', ' '.join(policy.route_problems([route], stale)))

    def test_allowlist_entry_for_a_route_that_now_passes_is_an_error(self):
        route = only(HEAD + "    @requires_capability('a.b')\n    def f(self): pass\n")
        allow = {**NO_ALLOW, 'no_capability': {route.key: 'because'}}
        self.assertIn('no longer needs', ' '.join(policy.route_problems([route], allow)))

    def test_allowlist_entry_needs_a_reason(self):
        route = only(HEAD + "    def f(self): pass\n")
        allow = {**NO_ALLOW, 'no_capability': {route.key: ' '}}
        self.assertIn('reason is empty', ' '.join(policy.route_problems([route], allow)))


class DynamicModelTests(unittest.TestCase):
    def test_dynamic_model_names_are_flagged_but_constants_and_forwarded_literals_are_not(self):
        source = (
            "TABLE = {'a': 'res.partner'}\n"
            "MODEL = 'res.users'\n"
            "def bad(request_model):\n    return request.env[request.params['m']]\n"
            "def by_constant():\n    return request.env[MODEL]\n"
            "def by_table(key):\n    name = TABLE.get(key)\n    return request.env[name]\n"
            "def helper(model):\n    return request.env[model]\n"
            "def caller():\n    return helper('res.partner')\n"
        )
        found = policy.dynamic_models({FAKE: ast.parse(source)})
        self.assertEqual(len(found), 1)
        self.assertIn("request.params['m']", found[0])

    def test_helper_called_with_request_data_is_flagged(self):
        source = (
            "def helper(model):\n    return request.env[model]\n"
            "def caller(payload):\n    return helper(payload['model'])\n"
        )
        self.assertEqual(len(policy.dynamic_models({FAKE: ast.parse(source)})), 1)


class TreeTests(unittest.TestCase):
    def test_current_tree_passes(self):
        self.assertEqual(policy.check(), [])


if __name__ == '__main__':
    unittest.main()

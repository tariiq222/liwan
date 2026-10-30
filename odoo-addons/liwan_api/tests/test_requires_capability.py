# Part of Odoo. See LICENSE file for full copyright and licensing details.
from types import SimpleNamespace
from unittest import mock

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers import common
from odoo.addons.liwan_api.controllers.common import ApiError, requires_capability


class _Env:
    """A request.env stand-in whose access service holds exactly ``held`` and records the keys it was asked."""

    user = object()
    uid = None

    def __init__(self, held):
        self.asked = []
        self.service = SimpleNamespace(_liwan_has_capability=self._has)
        self.held = held

    def _has(self, _user, key):
        self.asked.append(key)
        return key in self.held

    def __getitem__(self, name):
        assert name == 'liwan.access.service'
        return self.service


@tagged('post_install', '-at_install', 'liwan')
class TestRequiresCapability(TransactionCase):

    def _run(self, keys, held, **kwargs):
        env = _Env(held)

        @requires_capability(*keys, **kwargs)
        def handler():
            return 'ran'

        with mock.patch.object(common, 'request', SimpleNamespace(env=env)):
            try:
                return handler(), env.asked
            except ApiError as error:
                return error, env.asked

    def test_all_is_the_default_and_names_the_first_missing_key(self):
        result, asked = self._run(('a.read', 'a.write'), {'a.read'})
        self.assertEqual((result.status, result.code, result.message), (403, 'forbidden', 'a.write capability is required'))
        self.assertEqual(asked, ['a.read', 'a.write'])

    def test_all_stops_at_the_first_missing_key(self):
        result, asked = self._run(('a.read', 'a.write'), set())
        self.assertEqual(result.message, 'a.read capability is required')
        self.assertEqual(asked, ['a.read'])

    def test_all_runs_the_handler_when_every_key_is_held(self):
        self.assertEqual(self._run(('a.read', 'a.write'), {'a.read', 'a.write'})[0], 'ran')

    def test_any_accepts_one_key_and_short_circuits(self):
        result, asked = self._run(('a.read', 'a.write'), {'a.read', 'a.write'}, match='any')
        self.assertEqual((result, asked), ('ran', ['a.read']))

    def test_any_refuses_when_no_key_is_held(self):
        result, asked = self._run(('a.read', 'a.write'), set(), match='any')
        self.assertEqual((result.status, result.message), (403, 'one of a.read, a.write capability is required'))
        self.assertEqual(asked, ['a.read', 'a.write'])

    def test_the_declaration_is_validated_and_recorded(self):
        with self.assertRaises(ValueError):
            requires_capability()
        with self.assertRaises(ValueError):
            requires_capability('a.read', match='some')

        @requires_capability('a.read', 'a.write', match='any')
        def handler():
            return None

        self.assertEqual((handler._liwan_capability_keys, handler._liwan_capability_match),
                         (('a.read', 'a.write'), 'any'))

# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import mock

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_pmo.serializers import task as task_serializer
from odoo.addons.liwan_pmo.serializers.task import MAX_ALLOCATED_HOURS, parse_task_vals


@tagged('post_install', '-at_install', 'liwan')
class TestTaskNumericInput(TransactionCase):

    def _parse(self, payload):
        return parse_task_vals(payload, can_manage=True, task=None)

    def test_allocated_hours_accepts_a_finite_non_negative_number_and_null(self):
        self.assertEqual(self._parse({'allocated_hours': 4}), {'allocated_hours': 4.0})
        self.assertEqual(self._parse({'allocated_hours': 0.5}), {'allocated_hours': 0.5})
        self.assertEqual(self._parse({'allocated_hours': None}), {'allocated_hours': 0.0})

    def test_allocated_hours_rejects_every_unusable_value(self):
        for value in (float('nan'), float('inf'), True, '4', -1, MAX_ALLOCATED_HOURS + 1, [4]):
            with self.subTest(value=value), self.assertRaises(ApiError) as caught:
                self._parse({'allocated_hours': value})
            self.assertEqual((caught.exception.status, caught.exception.code, caught.exception.field), (422, 'invalid', 'allocated_hours'))

    def test_an_allowed_key_without_a_parser_fails_loudly(self):
        with mock.patch.object(task_serializer, 'MANAGER_FIELDS', task_serializer.MANAGER_FIELDS | {'unparsed'}):
            with self.assertRaises(NotImplementedError):
                self._parse({'unparsed': 1})

# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers import csv_export


@tagged('post_install', '-at_install', 'liwan')
class TestCsvExportLimit(TransactionCase):

    def test_the_limit_is_fifty_thousand_rows(self):
        self.assertEqual(csv_export.EXPORT_MAX_ROWS, 50_000)

    def test_a_count_up_to_the_limit_passes(self):
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 3):
            for rows in (0, 2, 3):
                with self.subTest(rows=rows):
                    self.assertIsNone(csv_export.refuse_oversized_export(rows))

    def test_a_count_above_the_limit_is_refused_with_both_numbers(self):
        with patch.object(csv_export, 'EXPORT_MAX_ROWS', 3), self.assertRaises(ApiError) as caught:
            csv_export.refuse_oversized_export(4)
        error = caught.exception
        self.assertEqual((error.status, error.code), (422, 'export_too_large'))
        self.assertEqual(error.details, {'rows': 4, 'max_rows': 3})

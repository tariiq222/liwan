# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueHrCase

PNG_PIXEL = (
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lH2zrwAAAABJRU5ErkJggg=='
)


@tagged('post_install', '-at_install', 'webvue')
class TestHrAvatarRoute(WebVueHrCase):
    """The avatar URL the app builds is the one stock image route a session keeps."""

    def test_employee_avatar_is_served_and_takes_no_query(self):
        employee = self.env['hr.employee'].create({'name': 'Avatar Holder', 'image_1920': PNG_PIXEL})
        self.authenticate('api_emp', 'api_emp_pass_123')
        path = f'/web/image/hr.employee/{employee.id}/avatar_128'
        self.assertEqual(self.url_open(path).status_code, 200)
        self.assertEqual(self.url_open(f'{path}?download=true').status_code, 404)
        self.assertEqual(self.url_open(f'/web/image/hr.employee/{employee.id}/image_1920').status_code, 404)

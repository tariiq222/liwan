# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestShadcnUi(HttpCase):
    def test_shadcn_tour(self):
        self.start_tour("/odoo", "web_theme_shadcn_tour", login="admin")

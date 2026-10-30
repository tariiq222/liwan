# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueDirectory(models.AbstractModel):
    """The people picker: active internal users of the current company.

    Ids are ``res.users`` ids (the ``PersonRef`` contract), never HR employee
    ids. Every lookup runs in the caller's environment.
    """
    _name = 'webvue.directory'
    _description = 'WebVue people directory'
    _webvue_scope = 'global'

    @api.model
    def _webvue_directory_feature_keys(self):
        """Feature keys that open /api/v1/people, composed through super().

        Each application that picks people adds its own key; the route is
        open while any of them is readable.
        """
        return ()

    @api.model
    def _webvue_people_domain(self):
        return [
            ('active', '=', True),
            ('share', '=', False),
            ('company_ids', 'in', [self.env.company.id]),
        ]

    @api.model
    def _webvue_search_people(self, query=None, limit=20, offset=0):
        domain = self._webvue_people_domain()
        if query:
            domain.append(('name', 'ilike', query))
        return self.env['res.users'].search(domain, order='name, id', limit=limit, offset=offset)

    @api.model
    def _webvue_people(self, user_ids):
        """The users among ``user_ids`` that belong to the picker population."""
        return self.env['res.users'].search([('id', 'in', list(user_ids)), *self._webvue_people_domain()])

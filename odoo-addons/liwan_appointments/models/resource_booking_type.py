# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models


class ResourceBookingType(models.Model):
    _inherit = 'resource.booking.type'

    # The engine allows a company-less type, visible to every company; LiwanOS types
    # belong to one company (database-per-tenant still hosts several companies).
    company_id = fields.Many2one(required=True, default=lambda self: self.env.company)

    @api.model
    def default_get(self, fields_list):
        defaults = super().default_get(fields_list)
        type_defaults = self.env['liwan.appointment.settings']._liwan_type_defaults()
        for name, value in type_defaults.items():
            if name in fields_list and 'default_' + name not in self.env.context:
                defaults[name] = value
        return defaults

    @api.constrains('company_id')
    def _check_combinations_company(self):
        self.combination_rel_ids._check_type_company()

    def _liwan_combination_commands(self, combinations):
        """The commands that make this type serve exactly ``combinations``, in that order.

        A combination the type already serves keeps its relation row; the rest are created or deleted.
        """
        self.ensure_one()
        by_combination = {rel.combination_id: rel for rel in self.combination_rel_ids}
        commands = [Command.delete(rel.id) for combination, rel in by_combination.items() if combination not in combinations]
        for sequence, combination in enumerate(combinations):
            rel = by_combination.get(combination)
            if rel:
                commands.append(Command.update(rel.id, {'sequence': sequence}))
            else:
                commands.append(Command.create({'combination_id': combination.id, 'sequence': sequence}))
        return commands

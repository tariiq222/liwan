# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models

from .appointment_settings import DEFAULTS


class ResourceBookingType(models.Model):
    """The booking type's modification deadline: its own, or the company policy it follows.

    A type either inherits the company's ``modification_deadline_hours`` or carries its own value. Both states are
    explicit and stored (`inherits_company_deadline`, `own_deadline_hours`), so a hand-set deadline is never mistaken
    for an inherited one, and the engine's ``modifications_deadline`` is resolved on every read: a saved company policy
    reaches every inheriting type at once without rewriting a row (issue #551). ``_liwan_resolved_deadlines`` is the
    single resolver, used by the computed field the engine and the booking routes read and by the serializer.
    """

    _inherit = 'resource.booking.type'

    # The engine allows a company-less type, visible to every company; LiwanOS types
    # belong to one company (database-per-tenant still hosts several companies).
    company_id = fields.Many2one(required=True, default=lambda self: self.env.company)
    inherits_company_deadline = fields.Boolean(
        default=True,
        help='The type follows the company modification deadline. Turn this off to give the type its own deadline.',
    )
    own_deadline_hours = fields.Float(
        string='Own modification deadline (hours)',
        help='Hours before the start after which the requester may no longer change the booking. '
             'Used only while the type does not follow the company deadline.',
    )
    # The deadline every rule reads: the engine's overdue and slot searches, the booking routes and the serializers.
    # It is read-only on purpose: the type's state is the pair above, so a write never guesses which one changed.
    modifications_deadline = fields.Float(
        compute='_compute_modifications_deadline', store=False, string='Modification deadline (hours)',
        help='Hours before the start after which the requester may no longer change the booking: the type\'s own '
             'deadline, or the company setting while the type follows it.',
    )

    @api.depends('inherits_company_deadline', 'own_deadline_hours', 'company_id')
    def _compute_modifications_deadline(self):
        deadlines = self._liwan_resolved_deadlines()
        for booking_type in self:
            booking_type.modifications_deadline = deadlines[booking_type.id]

    def _liwan_resolved_deadlines(self):
        """``{type id: deadline hours}`` for this recordset: the type's own value, or its company's setting.

        One settings search per company, whatever the number of types. The declared default (24 hours) answers while a
        company has saved no settings, and for a type of a company the caller may not read: such a type is hidden by the
        type's own record rule, and the policy of another company is never exposed here.
        """
        policies = {}
        for booking_type in self:
            company = booking_type.company_id
            if company not in policies:
                policies[company] = self._liwan_company_deadline_hours(company)
        return {
            booking_type.id: policies[booking_type.company_id] if booking_type.inherits_company_deadline
            else booking_type.own_deadline_hours
            for booking_type in self
        }

    @api.model
    def _liwan_company_deadline_hours(self, company):
        """The deadline of ``company``'s appointment settings, or the declared default while it saved none.

        The settings are searched in the type's own company. ``company`` is one the caller may work in: a type of any
        other company is hidden by the type's own record rule, so this only ever answers for a company the reader was
        already allowed to see, and the settings record rule plus the Appointments capability decide the rest. Only the
        number is returned, never the settings row.
        """
        if not company or company not in self.env.companies:
            return DEFAULTS['modification_deadline_hours']
        settings = self.env['liwan.appointment.settings'].with_company(company).search(
            [('company_id', '=', company.id)], limit=1,
        )
        return settings.modification_deadline_hours if settings else DEFAULTS['modification_deadline_hours']

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

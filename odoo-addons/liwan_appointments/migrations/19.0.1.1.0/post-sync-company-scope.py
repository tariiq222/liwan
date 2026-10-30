# Part of Odoo. See LICENSE file for full copyright and licensing details.
from lxml import etree

from odoo import SUPERUSER_ID, api
from odoo.tools import file_open

# The three appointments.* capabilities replace the two types.* ones; Odoo does not remove the old rows on update.
OLD_PERMISSION_KEYS = ('appointments.types.read', 'appointments.types.manage')
ENGINE_RULES = ('rule_resource_booking_type_company', 'rule_resource_booking_company')


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {'active_test': False})
    _drop_replaced_permissions(env)
    _require_company_on_types(env)
    _backfill_combination_company(env)
    _write_engine_rule_domains(env)


def _drop_replaced_permissions(env):
    # Role grants cascade with the permission.
    env['liwan.access.permission'].search([('key', 'in', OLD_PERMISSION_KEYS)]).unlink()


def _require_company_on_types(env):
    # The field is required, so the ORM would optimise a company_id = False search away.
    env.cr.execute('SELECT id FROM resource_booking_type WHERE company_id IS NULL')
    types = env['resource.booking.type'].browse([row[0] for row in env.cr.fetchall()])
    if types:
        names = ', '.join('%s (id %d)' % (booking_type.name, booking_type.id) for booking_type in types)
        raise ValueError(
            'Booking types without a company: %s. Set a company on each of them before upgrading.' % names,
        )


def _backfill_combination_company(env):
    # The new required column was filled with the default company; a combination takes the company of its types.
    for combination in env['resource.booking.combination'].search([]):
        companies = combination.type_rel_ids.type_id.company_id
        if len(companies) > 1:
            raise ValueError(
                'Combination %s (id %d) serves types of different companies (%s). Split it per company before upgrading.'
                % (combination.display_name, combination.id, ', '.join(companies.mapped('name'))),
            )
        if companies and combination.company_id != companies:
            combination.company_id = companies


def _write_engine_rule_domains(env):
    # The engine's two rules are noupdate, so the data file cannot change them on upgrade: copy the
    # domains from appointments_rules.xml, their single source.
    with file_open('liwan_appointments/security/appointments_rules.xml', 'rb') as handle:
        tree = etree.parse(handle)
    for name in ENGINE_RULES:
        xmlid = 'resource_booking.%s' % name
        domain = tree.xpath('//record[@id=$id]/field[@name="domain_force"]/text()', id=xmlid)[0]
        env.ref(xmlid).domain_force = domain

# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

SENSITIVE_PARTS = ('password', 'secret', 'token', 'session_id', 'hash')


def _assert_safe(value):
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if any(part in lowered for part in SENSITIVE_PARTS):
                msg = 'sensitive_audit_key'
                raise ValidationError(msg)
            _assert_safe(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_safe(item)


class NasqAccessAudit(models.Model):
    _name = 'nasq.access.audit'
    _description = 'Nasq Access Audit Event'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    actor_id = fields.Many2one('res.users', index=True, ondelete='set null')
    action = fields.Char(required=True, index=True)
    target_type = fields.Selection([('user', 'User'), ('role', 'Role')], required=True, index=True)
    target_id = fields.Integer(required=True, index=True)
    target_name = fields.Char(required=True)
    result = fields.Selection([('succeeded', 'Succeeded')], required=True, default='succeeded')
    before = fields.Json()
    after = fields.Json()
    reason = fields.Text()

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.audit.read',
            )
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.audit.read',
            )
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.user.has_group('base.group_system'):
            msg = 'audit_is_immutable'
            raise AccessError(msg)
        return super().create(vals_list)

    def write(self, vals):
        msg = 'audit_is_immutable'
        raise AccessError(msg)

    def unlink(self):
        msg = 'audit_is_immutable'
        raise AccessError(msg)

    @api.model
    def _nasq_log(self, action, target, before=None, after=None, reason=None, actor=None):
        _assert_safe(before)
        _assert_safe(after)
        target_type = 'role' if target._name == 'nasq.access.role' else 'user'
        company = (target.company_id if 'company_id' in target._fields else False) or self.env.company
        actor = actor if actor is not None else self.env.user
        vals = {
            'company_id': company.id,
            'actor_id': actor.id if actor and not actor._is_public() else False,
            'action': action,
            'target_type': target_type,
            'target_id': target.id,
            'target_name': target.display_name,
            'before': before,
            'after': after,
            'reason': reason,
        }
        return super().create(vals)

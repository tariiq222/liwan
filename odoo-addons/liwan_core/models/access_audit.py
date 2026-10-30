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


class LiwanAccessAudit(models.Model):
    _name = 'liwan.access.audit'
    _description = 'LiwanOS Access Audit Event'
    _liwan_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    actor_id = fields.Many2one('res.users', index=True, ondelete='set null')
    action = fields.Char(required=True, index=True)
    target_type = fields.Selection([('user', 'User'), ('role', 'Role'), ('company', 'Company')], required=True, index=True)
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
            self.env['liwan.access.service']._liwan_require_capability(
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
            self.env['liwan.access.service']._liwan_require_capability(
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
    def _liwan_log(self, action, target, before=None, after=None, reason=None, actor=None):
        _assert_safe(before)
        _assert_safe(after)
        target_type = {'liwan.access.role': 'role', 'res.company': 'company'}.get(target._name, 'user')
        company = (target.company_id if 'company_id' in target._fields else False) or self.env.company
        actor = actor if actor is not None else self.env.user
        # A role has no display name: its names are name_ar / name_en.
        target_name = (target.name_ar or target.name_en) if target_type == 'role' else target.display_name
        vals = {
            'company_id': company.id,
            'actor_id': actor.id if actor and not actor._is_public() else False,
            'action': action,
            'target_type': target_type,
            'target_id': target.id,
            'target_name': target_name,
            'before': before,
            'after': after,
            'reason': reason,
        }
        # The server writes the entry after the caller's own capability check; the audit ACL lets only
        # system and access administrators create, so a settings manager would lose the whole write.
        return super(LiwanAccessAudit, self.sudo()).create(vals)

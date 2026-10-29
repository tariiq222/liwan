# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, LockError, ValidationError

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

TOKEN = object()


def trusted(env):
    return env.su or env.context.get('_operations_write') is TOKEN


def require(env, key, write=True):
    service = env['webvue.entitlement.service']
    if write:
        service.require('operations.enabled')
    else:
        service._webvue_assert_lifecycle()
        if not service._webvue_feature_read('operations.enabled'):
            raise AccessError(env._('Operations is not enabled.'))
    env['webvue.access.service']._webvue_require_capability(key)


def check_revision(record, revision):
    if isinstance(revision, bool) or not isinstance(revision, int) or revision != record.revision:
        code = 'conflict'
        raise WebVueAccessRule(code, record.env._('This record changed. Refresh and try again.'), status=409)


def text(env, value, label, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValidationError(env._('Invalid %(field)s.', field=label))
    return value.strip()


def reviewer_users(env, ids):
    if not isinstance(ids, list) or not ids or len(ids) > 20 or any(isinstance(i, bool) or not isinstance(i, int) or i <= 0 for i in ids):
        raise ValidationError(env._('Choose at least one valid reviewer.'))
    users = env['res.users'].search([('id', 'in', ids), ('active', '=', True), ('share', '=', False), ('company_ids', 'in', [env.company.id])])
    if set(users.ids) != set(ids):
        raise ValidationError(env._('Reviewers must be active users of the current company.'))
    return users


def lock_or_conflict(record, operation='read'):
    """Take the tier row lock; a concurrent holder answers the same 409 as a stale revision."""
    try:
        record._tier_lock(operation)
    except LockError as exc:
        code = 'conflict'
        raise WebVueAccessRule(code, record.env._('This record changed. Refresh and try again.'), status=409) from exc

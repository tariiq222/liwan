# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The write fence of read-only users and read-only branches.

``LiwanBase.create/write/unlink`` call :func:`assert_writable`, so the fence sits under every write surface
(HTTP, background code, tests) rather than beside one of them.

The acting identity is ``env.uid``:

* ``odoo.SUPERUSER_ID`` (the superuser identity: the operator, ``base.user_root`` crons, installs) is never fenced.
* ``sudo()`` and ``with_user`` keep or change the uid, never the rule: code that runs ``sudo()`` for a
  read-only user is still that user, and a job that runs ``with_user(read_only_user)`` is refused. Code that
  runs as the superuser and only carries a user's id as data is outside the ORM's reach.
* A record bound to a read-only branch company refuses writes from every non-superuser identity.
"""
import odoo

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

# Set (as ``cr.precommit.data`` key) while the settle writes seat and branch flags.
SETTLE_MARKER = 'liwan_platform.settle_excess'
SETTLE_FIELDS = {
    'res.users': frozenset({'liwan_read_only', 'liwan_seat_choice'}),
    'liwan.tenant.branch': frozenset({'read_only', 'seat_choice'}),
}

# Rows the system writes about the session itself or about a sign-in: a plain read triggers them, and the
# person has to be able to sign in, prove the second step and forget their own devices.
PLUMBING_MODELS = frozenset({
    'res.users.log',  # one row per sign-in
    'res.device',  # the session's device record
    'res.device.log',  # one row per request of a session
    'ir.logging',  # server-side log rows
    'bus.presence',  # online presence
    'liwan.login.code',  # the second-step code
    'liwan.login.code.quota',  # its attempt counter
    'liwan.login.device',  # remembered devices (the person can forget their own)
    'liwan.account.token',  # password-reset and invitation links
    'liwan.access.audit',  # every account action is audited, including a read-only user's own
})
# The recipient's own read state of a bell notification is not a business write.
NOTIFICATION_READ_FIELDS = frozenset({'is_read', 'read_date'})
# A read-only user may keep their own credentials, number and display preferences.
OWN_USER_FIELDS = frozenset({
    'password', 'liwan_mobile', 'lang', 'tz', 'liwan_appearance_mode', 'login_date',
})
# The language and time zone of a user are stored on their contact too.
OWN_PARTNER_FIELDS = frozenset({'lang', 'tz'})
# Identity and access administration is not a branch's business data; a read-only branch keeps its people.
BRANCH_EXEMPT_MODELS = frozenset({
    'res.users', 'liwan.access.assignment', 'liwan.access.role', 'liwan.access.permission',
    'liwan.access.branch', 'liwan.tenant.branch', 'liwan.tenant.profile',
})


def _root_uid(env):
    return env.uid == odoo.SUPERUSER_ID


def _settle_write(env, model, keys):
    flags = SETTLE_FIELDS.get(model)
    return bool(flags and env.cr.precommit.data.get(SETTLE_MARKER) and keys and keys <= flags)


def _own_security_mail(records, vals_list):
    """True when every mail about to be queued is addressed by the account to its own address.

    Odoo's new-connection and credential-change notices queue one ``mail.mail`` from the signing-in user to
    themselves (``mail/models/res_users.py`` ``_notify_security_setting_update``); a sign-in must not fail on it.
    """
    user = records.env.user
    return bool(vals_list) and all(
        vals.get('author_id') == user.partner_id.id and vals.get('email_to') == user.email_formatted
        and not vals.get('recipient_ids') for vals in vals_list
    )


def _own_mail_message(records, vals_list):
    """The message row that ``mail.mail`` inherits: outgoing, from the account's own partner, on no record."""
    partner = records.env.user.partner_id
    return bool(vals_list) and all(
        vals.get('author_id') == partner.id and vals.get('message_type') == 'email_outgoing' and not vals.get('res_id')
        for vals in vals_list
    )


def _allowed_for_read_only_user(records, keys, vals_list=None):
    """Writes a read-only user keeps: plumbing rows, bell read state, their own credentials and security notice."""
    model = records._name
    if model in PLUMBING_MODELS:
        return True
    if model == 'mail.mail':
        return _own_security_mail(records, vals_list)
    if model == 'mail.message':
        return _own_mail_message(records, vals_list)
    if model == 'mail.notification':
        return bool(keys) and keys <= NOTIFICATION_READ_FIELDS
    if model == 'res.partner':
        return bool(keys) and keys <= OWN_PARTNER_FIELDS and records == records.env.user.partner_id
    if model == 'res.users':
        return bool(keys) and keys <= OWN_USER_FIELDS and records == records.env.user
    return False


def _bound_companies(records):
    """The companies the RECORDS belong to; the company itself for ``res.company``.

    Read elevated: the acting user may hold the write grant on a row without the record-rule read of its
    company column, and the answer (a company id) reveals nothing the write itself would not.
    """
    if records._name == 'res.company':
        return records
    field = records._fields.get('company_id')
    if field is None or field.type != 'many2one' or field.comodel_name != 'res.company':
        return records.env['res.company']
    return records.sudo().company_id


def _refuse(code, message):
    raise LiwanAccessRule(code, message, status=403)


def _target_company_ids(vals, vals_list):
    values = [vals or {}, *(vals_list or ())]
    return {item['company_id'] for item in values if isinstance(item.get('company_id'), int)}


def assert_writable(records, operation, vals=None, vals_list=None):
    """Refuse a create, write or unlink by or inside a read-only identity.

    VALS is the written dict of a write and VALS_LIST the values of a create. A create calls this twice:
    before the insert with no records (the identity check and the companies the values name) and after it
    with the new rows (the company they ended up with); the raise rolls the insert back.
    """
    env = records.env
    if _root_uid(env):
        return
    model = records._name
    keys = set(vals or ())
    if _settle_write(env, model, keys):
        return
    own_exempt = _allowed_for_read_only_user(records, keys, vals_list)
    # A create checks the identity before the insert; the second call, with the new rows, only asks about the company.
    identity_checked = operation == 'create' and bool(records)
    if not identity_checked and not own_exempt and env.user.liwan_read_only:
        _refuse('user_read_only', 'this account is read-only')
    if own_exempt or model in PLUMBING_MODELS or model in BRANCH_EXEMPT_MODELS:
        return
    if records and _bound_companies(records).filtered('liwan_read_only'):
        _refuse('branch_read_only', 'this branch is read-only')
    targets = _target_company_ids(vals, vals_list)
    if targets and env['res.company'].browse(targets).filtered('liwan_read_only'):
        _refuse('branch_read_only', 'this branch is read-only')

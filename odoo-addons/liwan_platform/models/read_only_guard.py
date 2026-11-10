# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The write fence of read-only users and read-only branches.

``LiwanBase.create/write/unlink`` call :func:`assert_writable`, so the fence sits under every write surface
(HTTP, background code, tests) rather than beside one of them.

The acting identity is ``env.uid``:

* ``odoo.SUPERUSER_ID`` (the superuser identity: the operator, ``base.user_root`` crons, installs) is never fenced.
* ``sudo()`` and ``with_user`` keep or change the uid, never the rule: code that runs ``sudo()`` for a
  read-only user is still that user, and a job that runs ``with_user(read_only_user)`` is refused. Code that
  runs as the superuser and only carries a user's id as data is outside the ORM's reach.
* A record bound to a read-only branch company refuses writes from every non-superuser identity. The owner
  comes from its own company field or an owning record (including parents of attachments and messages).
* Applications register what a read has to write (own bookkeeping rows, defaults seeded on first read) through
  ``liwan.entitlement.service._liwan_read_only_allowances``; the platform names none of their models.
* Inbound events from outside (a gateway callback) are recorded whatever the branch's state: the route sets
  ``INBOUND_EVENT_CONTEXT`` to ``INBOUND_EVENT_TOKEN`` for its own request, which lifts only the branch fence.
"""
import odoo

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

# A route that records an event from outside (money already on its way) sets this context key to the token below for
# its request. Only the branch fence is lifted: the acting identity of such a route is never a flagged user.
INBOUND_EVENT_CONTEXT = 'liwan_platform.inbound_event'
INBOUND_EVENT_TOKEN = object()

# Set (as ``cr.precommit.data`` key) while the settle writes seat and branch flags.
SETTLE_MARKER = 'liwan_platform.settle_excess'
SETTLE_FIELDS = {
    'res.users': frozenset({'liwan_read_only', 'liwan_seat_choice'}),
    'liwan.tenant.branch': frozenset({'read_only', 'seat_choice'}),
    'ir.attachment': frozenset({'liwan_storage_blocked'}),
}

# Rows the system writes about the session itself or about a sign-in: a plain read triggers them, and the
# person has to be able to sign in, prove the second step and forget their own devices.
PLUMBING_MODELS = frozenset({
    'res.users.log',  # one row per sign-in
    'res.device',  # the session's device record
    'res.device.log',  # one row per request of a session
    'ir.logging',  # server-side log rows
    'bus.presence',  # online presence
    'bus.bus',  # `bus._sendone` queues a notification as the acting user; every bell and live update goes through it
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
    'password', 'liwan_mobile', 'lang', 'tz', 'liwan_appearance_mode', 'liwan_font_size', 'login_date',
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
        return bool(records and keys) and keys <= NOTIFICATION_READ_FIELDS and all(
            row.res_partner_id == records.env.user.partner_id for row in records
        )
    if model == 'res.partner':
        return bool(keys) and keys <= OWN_PARTNER_FIELDS and records == records.env.user.partner_id
    if model == 'res.users':
        return bool(keys) and keys <= OWN_USER_FIELDS and records == records.env.user
    return False


# Records that hang on another record: the (model, id) fields to follow to it. The company of the record they hang
# on binds them, whatever company the row itself carries (an attachment defaults to its uploader's company and a
# message has none).
PARENT_REFERENCES = {
    'ir.attachment': ('res_model', 'res_id'),
    'mail.message': ('model', 'res_id'),
    'mail.followers': ('res_model', 'res_id'),
    'mail.activity': ('res_model', 'res_id'),
}


def _owner_path(records):
    for name in ('company_id', 'owner_company_id'):
        field = records._fields.get(name)
        if field is not None and field.type == 'many2one' and field.comodel_name == 'res.company':
            return name
    return records._liwan_read_only_company_path


def _own_companies(records):
    """Read the owning company regardless of the actor's read grants."""
    if records._name == 'res.company':
        return records
    path = _owner_path(records)
    return records.sudo().mapped(path) if path else records.env['res.company']


def _parent_companies(records, vals=None, vals_list=None):
    """Find the owners of the current or proposed polymorphic parents."""
    pair = PARENT_REFERENCES.get(records._name)
    if not pair:
        return records.env['res.company']
    model_field, id_field = pair
    if records:
        vals = vals or {}
        parents = (
            (vals[model_field] if model_field in vals else row[model_field],
             vals[id_field] if id_field in vals else row[id_field])
            for row in records.sudo()
        )
    else:
        parents = ((row.get(model_field), row.get(id_field)) for row in vals_list or ())
    ids_by_model = {}
    for model, res_id in parents:
        if isinstance(model, str) and type(res_id) is int and res_id > 0:
            if model in records.env and model not in BRANCH_EXEMPT_MODELS:
                ids_by_model.setdefault(model, set()).add(res_id)
    companies = records.env['res.company']
    for model, ids in ids_by_model.items():
        companies |= _own_companies(records.env[model].browse(ids).exists())
    return companies


def _bound_companies(records):
    """The companies the RECORDS belong to: their own and, for the records that hang on another, that one's."""
    return _own_companies(records) | _parent_companies(records)


def _registered_allowance(records, vals, vals_list):
    """True when an application registered this write as a read's own bookkeeping (see the module docstring)."""
    env = records.env
    allowances = env['liwan.entitlement.service']._liwan_read_only_allowances()
    if records._name in allowances['plumbing']:
        return True
    if any(env.context.get(key) is token for key, token in allowances['seed'].items()):
        return True
    if records._name in allowances['own']:
        user = env.user
        if records:
            return (vals or {}).get('user_id', user.id) == user.id and all(
                row.user_id == user for row in records
            )
        return bool(vals_list) and all(vals.get('user_id') == user.id for vals in vals_list)
    return False


def _refuse(code):
    raise LiwanAccessRule(code, status=403)


def _target_companies(records, vals, vals_list):
    path = _owner_path(records)
    if not path:
        return records.env['res.company']
    field_name, related, _tail = path.partition('.')
    ids = {
        value for row in (vals_list or (vals or {},))
        if type(value := row.get(field_name)) is int and value > 0
    }
    if not ids:
        return records.env['res.company']
    targets = records.env[records._fields[field_name].comodel_name].browse(ids).exists()
    return _own_companies(targets) if related else targets


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
    if _settle_write(env, model, keys) or _allowed_for_read_only_user(records, keys, vals_list):
        return
    # A create checks the identity before the insert; the second call, with the new rows, only asks about the company.
    identity_checked = operation == 'create' and bool(records)
    service = env['liwan.entitlement.service']
    due = service._liwan_post_trial_due()
    if not identity_checked and service._liwan_actor_read_only(env.user, trial_due=due):
        if not _registered_allowance(records, vals, vals_list):
            _refuse('user_read_only')
        return
    if model in BRANCH_EXEMPT_MODELS or env.context.get(INBOUND_EVENT_CONTEXT) is INBOUND_EVENT_TOKEN:
        return
    companies = _target_companies(records, vals, vals_list)
    if records:
        companies |= _bound_companies(records)
    parent_fields = PARENT_REFERENCES.get(model, ())
    if vals_list or keys.intersection(parent_fields):
        companies |= _parent_companies(records, vals=vals, vals_list=vals_list)
    restricted = companies.filtered('liwan_read_only')
    if due and companies:
        demote, reopen = service._liwan_branch_flag_changes()
        restricted = (restricted | (companies & demote.company_id)) - reopen.company_id
    if restricted and not _registered_allowance(records, vals, vals_list):
        _refuse('branch_read_only')

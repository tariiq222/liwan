# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.serializers.assets.common import reject_unknown


def split_revision(payload, *, minimum=1):
    """``(revision, other keys)`` of a revision-checked payroll settings write; 422 when the revision is missing.

    A stored row starts at revision 1; a company singleton that was never saved is revision 0 (``minimum=0``).
    """
    revision = payload.get('revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < minimum:
        raise ApiError(422, 'invalid', f'revision must be an integer of at least {minimum}', field='revision')
    return revision, {key: value for key, value in payload.items() if key != 'revision'}


def stored_revision(record):
    """The revision a client must send to change ``record``: 0 for a row that is not stored yet."""
    return record.revision if record.id else 0


def require_revision(record, revision, message):
    """409 ``conflict`` when ``revision`` is not the one of ``record`` (0 for a row that is not stored yet)."""
    if revision != stored_revision(record):
        raise ApiError(409, 'conflict', message)


def parse_delete_revision(payload):
    """The revision of a DELETE: its JSON body carries ``revision`` and nothing else."""
    revision, rest = split_revision(payload)
    reject_unknown(rest, ())
    return revision

# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Precommit markers that let one protected operation through the res.company / res.partner write guards."""
from contextlib import contextmanager


def is_marked_write(records, marker, fields, vals):
    """True when every record is marked for ``marker`` and ``vals`` only touches ``fields``."""
    allowed_ids = records.env.cr.precommit.data.get(marker, set())
    return bool(records.ids) and set(records.ids) <= allowed_ids and set(vals) <= fields


@contextmanager
def marked(env, marks):
    """Mark ``{marker: ids}`` for the duration of the block, restoring any previous marks after it."""
    data = env.cr.precommit.data
    previous = {marker: data.get(marker) for marker in marks}
    data.update({marker: set(ids) for marker, ids in marks.items()})
    try:
        yield
    finally:
        for marker, value in previous.items():
            if value is None:
                data.pop(marker, None)
            else:
                data[marker] = value

# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Leave the generic bell columns and their unique index to nasq_notify.

nasq_notify is a new dependency of nasq_pmo, so the upgrade installs and
loads it before this script runs. Loading it already pointed nasq_notify
xml ids at the same ir_model_fields rows and reflected the unique index
under nasq_notify. What is left is nasq_pmo's duplicate ownership of the
fields it no longer declares and of the index. This script first checks
that nasq_notify adopted every row nasq_pmo still owns (same model and
res_id) and has its own index row; any miss or mismatch stops the upgrade
before anything changes, because Odoo would otherwise drop the column with
its data. Then it deletes nasq_pmo's duplicates.

nasq_pmo keeps its xml id on nasq_notification_kind: it extends that field
with selection_add, and its selection values stay its own. Columns, the
index, mail_message rows and selection values are not touched. Re-running
the script changes nothing; a fresh install skips it.
"""

SOURCE = 'nasq_pmo'
TARGET = 'nasq_notify'
MOVED_FIELDS = tuple(
    f'field_{model}__{field}'
    for model in ('mail_message', 'mail_mail')
    for field in ('nasq_notification', 'nasq_notification_key')
)
ADOPTED_FIELDS = (
    *MOVED_FIELDS,
    'field_mail_message__nasq_notification_kind',
    'field_mail_mail__nasq_notification_kind',
)
CONSTRAINT = 'mail_message_nasq_notification_key_unique'
CONSTRAINT_XMLID = f'constraint_{CONSTRAINT}'


def _target(cr, module, name):
    cr.execute('SELECT model, res_id FROM ir_model_data WHERE module = %s AND name = %s', [module, name])
    return cr.fetchone()


def _constraint_ids(cr):
    cr.execute(
        '''
            SELECT m.name, c.id
              FROM ir_model_constraint c
              JOIN ir_module_module m ON m.id = c.module
             WHERE c.name = %s AND m.name IN %s
        ''',
        [CONSTRAINT, (SOURCE, TARGET)],
    )
    return dict(cr.fetchall())


def _stop(name, problem):
    msg = (
        f'nasq_pmo migration: {problem} ({name}). The upgrade stopped before nasq_pmo '
        f'gave up its copy, so no column or index was dropped. Check that nasq_notify '
        f'is installed and declares it, then run the upgrade again.'
    )
    raise ValueError(msg)


def migrate(cr, version):
    if not version:
        return
    duplicates = []
    for name in ADOPTED_FIELDS:
        source = _target(cr, SOURCE, name)
        if source is None:
            continue
        target = _target(cr, TARGET, name)
        if target is None:
            _stop(name, 'nasq_notify has not adopted this field')
        if tuple(target) != tuple(source):
            _stop(name, f'nasq_notify points at {tuple(target)} and nasq_pmo at {tuple(source)}')
        if name in MOVED_FIELDS:
            duplicates.append(name)
    constraints = _constraint_ids(cr)
    if SOURCE in constraints and TARGET not in constraints:
        _stop(CONSTRAINT, 'nasq_notify has not reflected the unique index')
    if duplicates:
        cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [SOURCE, duplicates])
    if SOURCE in constraints:
        cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = %s', [SOURCE, CONSTRAINT_XMLID])
        cr.execute('DELETE FROM ir_model_constraint WHERE id = %s', [constraints[SOURCE]])

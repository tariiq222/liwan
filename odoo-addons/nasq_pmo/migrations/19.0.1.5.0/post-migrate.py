# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Drop the table of the removed project template model.

A module update removes the ir.model rows of a model nasq_pmo no longer
declares, but not its table. Project templates are replaced by copying a
project, and no tenant holds template data, so the table is dropped.
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute('DROP TABLE IF EXISTS nasq_project_template')

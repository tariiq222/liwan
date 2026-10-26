# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib

from psycopg2.errors import ForeignKeyViolation, UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError, ConcurrencyError

from odoo.addons.webvue_hr.rules import WebVueHrRule

IMMUTABLE = 'payroll_file_is_immutable'
PROFILE_UNAVAILABLE = 'profile_unavailable'
# The database's own name for the ``profile_id`` foreign key below, whose ``ondelete='restrict'`` is what keeps a
# profile a kept file names. ``_webvue_delete`` on the profile and ``_webvue_keep`` here translate exactly this
# violation, and re-raise every other one; the tests read the name back from the database instead of trusting the
# naming rule.
PROFILE_FK = 'webvue_hr_payroll_file_profile_id_fkey'


class WebVueHrPayrollFile(models.Model):
    """A salary file as it was handed out: the bank or WPS file of a fixed run, kept once per distinct content.

    Two things together make a kept row and its bytes immutable (owner decision D-4). This model's own ``create``,
    ``write`` and ``unlink`` overrides refuse every caller but ``_webvue_keep``, and the ACL grants the payroll
    capabilities read and create only, no write and no unlink. Odoo's attachment guard follows the linked record's
    own rights for a field attachment, so on the stored ``content`` that missing write right is what refuses an
    ``ir.attachment`` write or unlink: no ``ir.attachment`` override and no extra security wrapper is involved.
    Rows are created only by ``_webvue_keep`` in the caller's own environment (no ``sudo()``).
    """

    _name = 'webvue.hr.payroll.file'
    _description = 'WebVue HR generated salary file'
    _webvue_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    run_id = fields.Many2one('hr.payslip.run', required=True, index=True, ondelete='restrict')
    kind = fields.Selection([('bank', 'Bank salary file'), ('wps', 'WPS file')], required=True)
    profile_id = fields.Many2one('webvue.hr.payroll.bank.profile', required=True, ondelete='restrict')
    value_date = fields.Date(required=True)
    filename = fields.Char(required=True)
    checksum = fields.Char(required=True, help='SHA-256 of the content, in hex.')
    content = fields.Binary(required=True, attachment=True)

    _run_content_unique = models.Constraint(
        'UNIQUE(run_id, checksum)', 'the same salary file content is kept once per run',
    )

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(IMMUTABLE)

    def write(self, vals):
        raise AccessError(IMMUTABLE)

    def unlink(self):
        raise AccessError(IMMUTABLE)

    @api.model
    def _webvue_keep(self, run, kind, profile, value_date, filename, content):
        """The kept row of ``content`` for ``run``: the existing one when the same bytes were kept before.

        The company is the run's; the caller holds ``hr.payroll.read`` there. A concurrent request that kept the
        same bytes first makes the INSERT fail: the request is retried whole, and the retry finds that row. A
        profile deleted after the caller resolved it is refused as a 409 ``profile_unavailable``, never as the
        database's own error, and the file is not kept under a profile that no longer exists.
        """
        run.ensure_one()
        company = run.company_id
        if not company or company not in self.env.companies:
            msg = 'payroll_file_company_out_of_scope'
            raise AccessError(msg)
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'hr.payroll.read', company=company):
            msg = 'payroll_file_capability_missing'
            raise AccessError(msg)
        checksum = hashlib.sha256(content).hexdigest()
        kept = self.search([('run_id', '=', run.id), ('checksum', '=', checksum)], limit=1)
        if kept:
            return kept
        try:
            with self.env.cr.savepoint():
                # The model refuses ``create``; this helper is the one place that writes past that refusal.
                return models.Model.create(self, [{
                    'company_id': company.id, 'run_id': run.id, 'kind': kind, 'profile_id': profile.id,
                    'value_date': value_date, 'filename': filename, 'checksum': checksum,
                    'content': base64.b64encode(content),
                }])
        except UniqueViolation as error:
            msg = 'payroll_file_kept_concurrently'
            raise ConcurrencyError(msg) from error
        except ForeignKeyViolation as error:
            # A concurrent delete of the profile won the race: only this profile's own key is translated, any
            # other violation (a run deleted under the same race included) keeps its own database error.
            if error.diag.constraint_name != PROFILE_FK:
                raise
            raise WebVueHrRule(
                PROFILE_UNAVAILABLE,
                self.env._('This salary file profile was deleted before its file could be kept.'),
                status=409,
            ) from None

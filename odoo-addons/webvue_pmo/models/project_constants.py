# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Named constants and shared validators for the webvue_pmo project models."""
from odoo.exceptions import UserError, ValidationError

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by webvue (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}
VISIBILITY_VALUES = ('employees', 'followers')
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
POLICY_CREATE_MARKER = 'webvue_pmo.policy_create'
OBJECTIVE_KEYS = ('goal', 'metric', 'target')
DELIVERABLE_KEYS = ('name', 'description', 'acceptance')
BUDGET_STATES = ('unknown', 'estimate')
PRIORITY_VALUES = ('low', 'normal', 'high', 'critical')
CHARTER_STATES = ('draft', 'submitted', 'approved')
CHARTER_RETURN_NOTE_MAX = 2000
CHARTER_TEXT_FIELDS = (
    'webvue_authority', 'webvue_rationale', 'webvue_benefits', 'webvue_scope',
    'webvue_exclusions', 'webvue_high_level_requirements', 'webvue_success',
    'webvue_assumptions', 'webvue_constraints', 'webvue_closure',
)
CHARTER_JSON_FIELDS = ('webvue_objectives', 'webvue_deliverables')
CHARTER_MANAGER_FIELDS = {
    'webvue_type_id', 'webvue_owning_unit_id', 'webvue_sponsor_id',
    'webvue_budget_state', 'webvue_budget_amount', 'webvue_priority',
    *CHARTER_TEXT_FIELDS, *CHARTER_JSON_FIELDS,
}
PROTECTED_FIELDS = {'webvue_code', 'webvue_revision'}
# Written only by the charter transitions (_webvue_charter_*), never by PATCH.
CHARTER_APPROVAL_FIELDS = {
    'webvue_charter_state', 'webvue_charter_submitted_by_id', 'webvue_charter_submitted_at',
    'webvue_charter_approved_by_id', 'webvue_charter_approved_at', 'webvue_charter_return_note',
}
# Content a submitted charter locks and an approved one reopens on change.
# The sponsor is content too: it cannot change while the charter waits (the manager
# withdraws first), so a manager cannot swap in themself to self-approve.
CHARTER_CONTENT_FIELDS = CHARTER_MANAGER_FIELDS | {
    'name', 'description', 'user_id', 'date_start', 'date',
}
CHARTER_RESET_VALS = {
    'webvue_charter_state': 'draft',
    'webvue_charter_submitted_by_id': False, 'webvue_charter_submitted_at': False,
    'webvue_charter_approved_by_id': False, 'webvue_charter_approved_at': False,
}
# Fields a webvue manager (group or per-project assigned user) may write via
# _webvue_write_as_manager/_webvue_write_sudo. Anything else must go through a
# dedicated, explicitly-reviewed path instead of this generic sudo'd write.
MANAGER_WRITABLE = {
    'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date',
    'tag_ids', 'active', 'last_update_status', 'allow_milestones', 'allow_task_dependencies', 'type_ids',
    'webvue_completion_approval', 'webvue_completion_approver_id',
} | CHARTER_MANAGER_FIELDS
PROJECT_CREATE_FIELDS = MANAGER_WRITABLE | {'company_id', 'webvue_code'}
REVISION_CONTENT_FIELDS = MANAGER_WRITABLE | {'company_id'} | CHARTER_APPROVAL_FIELDS
COMPLETION_APPROVAL_VALUES = ('none', 'project_manager', 'specific_user')
COMPLETION_BACKFILL_PARAM = 'webvue_pmo.completion_status_backfill_v1_done'


def _not_empty(message, count):
    err = UserError(message)
    err.webvue_count = count
    return err


def _validate_charter_rows(rows, keys, label):
    if rows is None or rows is False:
        return
    if not isinstance(rows, list):
        raise ValidationError(f"{label} must be a list.")
    expected = set(keys)
    for row in rows:
        if not isinstance(row, dict) or set(row) != expected:
            raise ValidationError(f"{label} rows must use exactly {keys}.")
        if any(not isinstance(row[key], str) for key in keys):
            raise ValidationError(f"{label} values must be strings.")
        if not any(row[key].strip() for key in keys):
            raise ValidationError(f"{label} rows must include at least one non-blank value.")

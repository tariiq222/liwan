# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """Every stored stage snapshot names its resolver, capability and skipped flag, as the engine now reads them."""
    if not version:
        return
    cr.execute(
        """
        UPDATE liwan_operation_request
           SET stage_snapshot = (
               SELECT COALESCE(jsonb_agg(
                          jsonb_build_object('resolver', 'null'::jsonb, 'capability', 'operations.requests.review', 'skipped', false) || stage
                          ORDER BY position), '[]'::jsonb)
                 FROM jsonb_array_elements(stage_snapshot) WITH ORDINALITY AS stages(stage, position))
         WHERE jsonb_typeof(stage_snapshot) = 'array'
           AND jsonb_array_length(stage_snapshot) > 0
           AND NOT (stage_snapshot -> 0) ? 'skipped'
        """,
    )

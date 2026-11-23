# Part of Odoo. See LICENSE file for full copyright and licensing details.

RETIRED_KEYS = ('inbox.tiktok',)


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        '''
        UPDATE liwan_tenant_profile
           SET features = features - %s::text[],
               post_trial_features = post_trial_features - %s::text[],
               retained_read_features = retained_read_features - %s::text[]
        ''',
        [list(RETIRED_KEYS)] * 3,
    )

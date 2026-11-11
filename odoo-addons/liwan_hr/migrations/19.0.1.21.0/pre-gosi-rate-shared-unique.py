# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """Refuse the upgrade while two shared GOSI rate rows start on the same day.

    A shared row has no company, and a UNIQUE constraint treats two NULLs as different, so until now
    nothing stopped a duplicate. Which of two shared rows is right is the operator's call, so the
    migration lists them and stops instead of deleting one. Re-running it after the duplicates are
    removed changes nothing else.
    """
    if not version:
        return
    cr.execute(
        """
        SELECT branch, nationality_class, date_from, array_agg(id ORDER BY id)
          FROM liwan_hr_gosi_rate
         WHERE company_id IS NULL
         GROUP BY branch, nationality_class, date_from
        HAVING count(*) > 1
        """,
    )
    duplicates = cr.fetchall()
    if duplicates:
        listing = '; '.join(f'{branch}/{nationality}/{day}: ids {ids}' for branch, nationality, day, ids in duplicates)
        raise RuntimeError(
            'Shared GOSI rates (liwan_hr_gosi_rate, company_id IS NULL) repeat a branch, class and start date; '
            f'keep one row of each group and delete the others before upgrading: {listing}',
        )

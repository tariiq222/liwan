# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """The chart is loaded when a tenant is installed, not by a setup step: the `chart_loaded` audit action is gone."""
    if not version:
        return
    cr.execute("DELETE FROM liwan_finance_audit_event WHERE action = 'chart_loaded'")

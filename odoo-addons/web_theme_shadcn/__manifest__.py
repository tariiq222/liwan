# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    "name": "shadcn Backend Theme",
    "summary": "shadcn/ui-style backend: icon app rail, collapsible app panel, zinc palette",
    "version": "19.0.1.0.0",
    "category": "Hidden",
    "author": "Tariq Alwalidi",
    "license": "LGPL-3",
    "depends": ["web"],
    "excludes": ["web_enterprise", "web_responsive"],
    "installable": True,
    "auto_install": False,
    "assets": {
        "web._assets_primary_variables": [
            (
                "before",
                "web/static/src/scss/primary_variables.scss",
                "web_theme_shadcn/static/src/scss/primary_variables.scss",
            ),
            (
                "before",
                "web/static/src/**/*.variables.scss",
                "web_theme_shadcn/static/src/scss/navbar.variables.scss",
            ),
        ],
        "web._assets_backend_helpers": [
            (
                "before",
                "web/static/src/scss/bootstrap_overridden.scss",
                "web_theme_shadcn/static/src/scss/bootstrap_overridden.scss",
            ),
        ],
        "web._assets_frontend_helpers": [
            (
                "before",
                "web/static/src/scss/bootstrap_overridden_frontend.scss",
                "web_theme_shadcn/static/src/scss/frontend_reset.scss",
            ),
        ],
        "web.assets_backend": [
            "web_theme_shadcn/static/src/scss/fonts.scss",
            "web_theme_shadcn/static/src/webclient/**/*",
            "web_theme_shadcn/static/src/scss/theme.scss",
        ],
        "web.assets_unit_tests": [
            "web_theme_shadcn/static/tests/**/*.test.js",
        ],
        "web.assets_tests": [
            "web_theme_shadcn/static/tests/tours/**/*",
        ],
    },
}

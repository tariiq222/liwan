# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestShadcnAssets(TransactionCase):
    """The backend bundle must compile with the theme's SCSS injected."""

    def _compile(self, bundle_name):
        bundle = self.env["ir.qweb"]._get_asset_bundle(bundle_name, js=False, debug_assets=True)
        bundle.css()
        self.assertFalse(bundle.css_errors, "\n".join(bundle.css_errors))
        return bundle

    def test_backend_bundle_compiles(self):
        bundle = self._compile("web.assets_backend")
        self.assertTrue(bundle.files, "bundle is empty")

    def test_theme_files_are_in_backend_bundle(self):
        bundle = self._compile("web.assets_backend")
        urls = [f["url"] for f in bundle.files]
        self.assertTrue(
            any("web_theme_shadcn/static/src/scss/primary_variables.scss" in u for u in urls),
            "primary_variables.scss not injected",
        )

    def test_tokens_present_in_compiled_css(self):
        bundle = self._compile("web.assets_backend")
        css = bundle.css().raw.decode()
        self.assertIn("--o-shadcn-rail-width:56px", css.replace(" ", ""))
        self.assertIn("font-family:IBMPlexSansArabic", css.replace(" ", "").replace('"', ""))
        # primary button must be zinc-900, not Odoo purple.
        # NB: scoped to the .btn-primary rule rather than the whole bundle: html_editor
        # (auto-installed, out of this addon's scope) hardcodes #71639e as a literal
        # (not variable-driven) highlight color on its table-picker widget, so a
        # bundle-wide search for that hex is a false negative unrelated to our tokens.
        btn_primary_idx = css.find(".btn-primary {")
        self.assertNotEqual(btn_primary_idx, -1, ".btn-primary rule not found")
        btn_primary_rule = css[btn_primary_idx : css.find("}", btn_primary_idx)]
        self.assertNotIn("#71639e", btn_primary_rule.lower())
        self.assertIn("#18181b", btn_primary_rule.lower())

    def test_theme_rules_present(self):
        css = self._compile("web.assets_backend").css().raw.decode().replace(" ", "")
        for selector in (".o_web_client.o_form_sheet", ".o_web_client.o_kanban_record", ".o_web_client.o_control_panel"):
            self.assertIn(selector, css, f"{selector} missing from theme.scss output")
        self.assertIn(
            "body.o_web_client:not(:has(>.o_navbar))",
            css,
            "fullscreen rule from Task 4 missing from compiled CSS",
        )
        # The sheet must drive upstream's custom property, not shorthand over it:
        # only the radius and the colour belong to the theme, the border width and
        # the paddings stay breakpoint-driven in form_controller.scss.
        # (whitespace-stripped: the bundle keeps a newline after every `{`)
        packed = re.sub(r"\s+", "", css)
        self.assertIn(
            ".o_web_client.o_form_sheet{--formView-sheet-border-radius:.75rem", packed,
        )
        self.assertNotIn(".o_web_client.o_form_sheet{border:1px", packed)

    def test_layout_rules_present(self):
        # the compiled bundle keeps newlines between a selector and its declarations
        css = re.sub(r"\s+", "", self._compile("web.assets_backend").css().raw.decode())
        self.assertIn(
            "body.o_web_client>.o-main-components-container{display:contents",
            css,
            "MainComponentsContainer must not take a grid cell",
        )
        self.assertIn(
            "--o-navbar-height:48px",
            css,
            "navbar.variables.scss height override did not land",
        )

    def test_frontend_bundle_does_not_reference_theme_font(self):
        """The theme's webfont is backend-only: the portal must keep Odoo's stack."""
        css = self._compile("web.assets_frontend").css().raw.decode().replace(" ", "")
        self.assertNotIn("IBMPlexSansArabic", css.replace('"', ""))

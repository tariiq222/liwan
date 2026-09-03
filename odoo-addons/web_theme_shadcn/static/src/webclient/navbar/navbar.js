// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { onWillDestroy, useEffect, useState } from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { isMacOS } from "@web/core/browser/feature_detection";
import { _t } from "@web/core/l10n/translation";
import { useHotkey } from "@web/core/hotkeys/hotkey_hook";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { NavBar } from "@web/webclient/navbar/navbar";
import { AppRail } from "@web_theme_shadcn/webclient/app_rail/app_rail";
import { AppPanel } from "@web_theme_shadcn/webclient/app_panel/app_panel";

export const PANEL_STORAGE_KEY = "web_theme_shadcn.panel";

patch(NavBar, {
    components: { ...NavBar.components, AppRail, AppPanel },
});
NavBar.template = "web_theme_shadcn.NavBar";

patch(NavBar.prototype, {
    setup() {
        super.setup();
        this.command = useService("command");
        this.shadcn = useState({
            panelCollapsed: browser.localStorage.getItem(PANEL_STORAGE_KEY) === "collapsed",
        });
        useHotkey("control+b", () => this.togglePanel(), { global: true });

        const onCurrentChanged = () => this.render();
        this.env.bus.addEventListener("MENUS:CURRENT-CHANGED", onCurrentChanged);
        // `.o_web_client` is <body> in the real client (webclient_templates.xml sets
        // it as body class); in unit tests it is the HOOT fixture.
        this.shadcnClientEl = null;
        useEffect(
            () => {
                this.shadcnClientEl = this.root.el?.closest(".o_web_client") || null;
                this.shadcnClientEl?.classList.toggle(
                    "o_shadcn_panel_collapsed",
                    this.shadcn.panelCollapsed
                );
            },
            () => [this.shadcn.panelCollapsed, this.root.el]
        );
        // onWillDestroy (rather than an effect cleanup) also runs when mounting failed.
        onWillDestroy(() => {
            this.env.bus.removeEventListener("MENUS:CURRENT-CHANGED", onCurrentChanged);
            for (const el of [this.shadcnClientEl, document.body]) {
                el?.classList.remove("o_shadcn_panel_collapsed");
            }
        });
    },

    // No horizontal section menu to fit anymore.
    async adapt() {},

    get isMacOS() {
        return isMacOS();
    },

    get panelToggleTitle() {
        return this.isMacOS ? _t("Toggle menu (⌘B)") : _t("Toggle menu (Ctrl+B)");
    },

    get currentMenuId() {
        return this.menuService.getCurrentMenuId?.();
    },

    togglePanel() {
        this.shadcn.panelCollapsed = !this.shadcn.panelCollapsed;
        browser.localStorage.setItem(
            PANEL_STORAGE_KEY,
            this.shadcn.panelCollapsed ? "collapsed" : "expanded"
        );
    },

    openCommandPalette() {
        this.command.openMainPalette({});
    },

    onRailAppSelected(app) {
        this.onNavBarDropdownItemSelection(app);
    },

    onPanelMenuSelected(menu) {
        this.onNavBarDropdownItemSelection(menu);
    },
});

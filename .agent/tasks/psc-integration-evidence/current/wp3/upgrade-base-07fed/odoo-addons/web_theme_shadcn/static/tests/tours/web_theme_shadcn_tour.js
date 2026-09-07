// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("web_theme_shadcn_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "Rail is visible on desktop",
            trigger: ".o_web_client .o_shadcn_rail",
        },
        {
            content: "Open Settings from the rail",
            trigger: '.o_shadcn_rail_app[data-menu-xmlid="base.menu_administration"]',
            run: "click",
        },
        {
            content: "Panel shows the Settings menus",
            trigger:
                '.o_shadcn_panel_item[data-menu-xmlid="base.menu_users"], .o_shadcn_panel_group[data-menu-xmlid="base.menu_users"]',
            run: "click",
        },
        {
            content: "Users list is displayed",
            trigger: '.o_shadcn_panel_item[data-menu-xmlid="base.menu_action_res_users"]',
            run: "click",
        },
        {
            content: "List view rendered",
            trigger: ".o_list_view .o_data_row",
        },
        {
            content: "Collapse the panel",
            trigger: ".o_shadcn_panel_toggle",
            run: "click",
        },
        {
            content: "Panel is gone, content still there",
            trigger: ".o_web_client.o_shadcn_panel_collapsed .o_list_view",
        },
        {
            content: "Apps dropdown still works (tour compat)",
            trigger: ".o_navbar_apps_menu button:enabled",
            run: "click",
        },
        {
            content: "Apps listed",
            trigger: '.o_app[data-menu-xmlid="base.menu_administration"]',
        },
    ],
});

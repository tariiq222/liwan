// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { expect, test } from "@odoo/hoot";
import { contains, mountWithCleanup } from "@web/../tests/web_test_helpers";
import { AppRail } from "@web_theme_shadcn/webclient/app_rail/app_rail";

const apps = [
    {
        id: 1,
        name: "Project",
        xmlid: "project.menu_main_pm",
        actionID: 10,
        webIconData: "data:image/png;base64,AAA",
    },
    { id: 2, name: "Employees", xmlid: "hr.menu_hr_root", actionID: 20 },
];

test("renders one link per app with tour-compatible attributes", async () => {
    await mountWithCleanup(AppRail, {
        props: {
            apps,
            currentApp: apps[0],
            onSelect: () => {},
            getHref: (m) => `/odoo/action-${m.actionID}`,
        },
    });
    expect(".o_shadcn_rail_app").toHaveCount(2);
    expect('.o_shadcn_rail_app[data-menu-xmlid="project.menu_main_pm"]').toHaveClass("active");
    expect('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveAttribute(
        "href",
        "/odoo/action-20"
    );
    expect('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveAttribute(
        "title",
        "Employees"
    );
    expect('.o_shadcn_rail_app[data-menu-xmlid="project.menu_main_pm"] img').toHaveCount(1);
    // app without icon shows its initial
    expect(
        '.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"] .o_shadcn_rail_initial'
    ).toHaveText("E");
});

test("clicking an app calls onSelect and prevents navigation", async () => {
    const selected = [];
    await mountWithCleanup(AppRail, {
        props: {
            apps,
            currentApp: undefined,
            onSelect: (app) => selected.push(app.id),
            getHref: () => "#",
        },
    });
    await contains('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').click();
    expect(selected).toEqual([2]);
});

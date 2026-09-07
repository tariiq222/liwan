// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { expect, test } from "@odoo/hoot";
import { contains, mountWithCleanup } from "@web/../tests/web_test_helpers";
import { AppPanel } from "@web_theme_shadcn/webclient/app_panel/app_panel";

const app = { id: 1, name: "Project", xmlid: "project.menu_main_pm" };
const sections = [
    { id: 11, name: "Tasks", xmlid: "project.menu_tasks", actionID: 101, childrenTree: [] },
    {
        id: 12,
        name: "Configuration",
        xmlid: "project.menu_config",
        childrenTree: [
            {
                id: 121,
                name: "Stages",
                xmlid: "project.menu_stages",
                actionID: 102,
                childrenTree: [],
            },
            { id: 122, name: "Tags", xmlid: "project.menu_tags", actionID: 103, childrenTree: [] },
        ],
    },
];
const getHref = (m) => `/odoo/action-${m.actionID}`;

test("renders the app name and the section tree", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    expect(".o_shadcn_panel_title").toHaveText("Project");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').toHaveAttribute(
        "href",
        "/odoo/action-101"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').toHaveAttribute(
        "data-hotkey",
        "1"
    );
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute(
        "aria-expanded",
        "false"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(0);
});

test("group toggles open and closed", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    await contains('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').click();
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute(
        "aria-expanded",
        "true"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(1);
    await contains('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').click();
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(0);
});

test("active item is highlighted and its group is expanded by default", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: 122, onSelect: () => {}, getHref },
    });
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute(
        "aria-expanded",
        "true"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tags"]').toHaveClass("active");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').not.toHaveClass("active");
});

test("clicking an item calls onSelect", async () => {
    const selected = [];
    await mountWithCleanup(AppPanel, {
        props: {
            app,
            sections,
            currentMenuId: undefined,
            onSelect: (m) => selected.push(m.id),
            getHref,
        },
    });
    await contains('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').click();
    expect(selected).toEqual([11]);
});

test("renders nothing useful without an app", async () => {
    await mountWithCleanup(AppPanel, {
        props: {
            app: undefined,
            sections: [],
            currentMenuId: undefined,
            onSelect: () => {},
            getHref,
        },
    });
    expect(".o_shadcn_panel").toHaveCount(1);
    expect(".o_shadcn_panel_item").toHaveCount(0);
});

test("first-level entries get hotkeys 1…9 then 0, and nothing beyond", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
        id: 100 + i,
        name: `Item ${i}`,
        xmlid: `test.menu_${i}`,
        actionID: 200 + i,
        childrenTree: [],
    }));
    await mountWithCleanup(AppPanel, {
        props: { app, sections: many, currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    expect('.o_shadcn_panel_item[data-menu-xmlid="test.menu_0"]').toHaveAttribute(
        "data-hotkey",
        "1"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="test.menu_8"]').toHaveAttribute(
        "data-hotkey",
        "9"
    );
    // 10th entry (index 9) -> "0", like upstream's menu sections
    expect('.o_shadcn_panel_item[data-menu-xmlid="test.menu_9"]').toHaveAttribute(
        "data-hotkey",
        "0"
    );
    expect('.o_shadcn_panel_item[data-menu-xmlid="test.menu_10"]').not.toHaveAttribute(
        "data-hotkey"
    );
});

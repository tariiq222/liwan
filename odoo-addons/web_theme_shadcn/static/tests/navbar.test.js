// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { beforeEach, destroy, expect, getFixture, test } from "@odoo/hoot";
import { press } from "@odoo/hoot-dom";
import { animationFrame } from "@odoo/hoot-mock";
import {
    contains,
    defineMenus,
    getService,
    makeMockEnv,
    mountWithCleanup,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { browser } from "@web/core/browser/browser";
import { NavBar } from "@web/webclient/navbar/navbar";

beforeEach(() => {
    defineMenus([
        { id: 1, name: "Project", xmlid: "project.menu_main_pm", actionID: 10 },
        { id: 2, name: "Employees", xmlid: "hr.menu_hr_root", actionID: 20 },
    ]);
    browser.localStorage.removeItem("web_theme_shadcn.panel");
});

test.tags("desktop");
test("top bar keeps the apps dropdown used by Odoo tours", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_topbar").toHaveCount(1);
    expect(".o_navbar_apps_menu button").toHaveCount(1);
    await contains(".o_navbar_apps_menu button").click();
    expect('.o_app[data-menu-xmlid="project.menu_main_pm"]').toHaveCount(1);
    expect('.o_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveCount(1);
});

test.tags("desktop");
test("rail and panel are rendered on desktop", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_rail").toHaveCount(1);
    expect(".o_shadcn_panel").toHaveCount(1);
});

test.tags("desktop");
test("panel collapses with the toggle button and persists", async () => {
    await mountWithCleanup(NavBar);
    await contains(".o_shadcn_panel_toggle").click();
    expect(".o_shadcn_panel").toHaveCount(0);
    expect(browser.localStorage.getItem("web_theme_shadcn.panel")).toBe("collapsed");
    await contains(".o_shadcn_panel_toggle").click();
    expect(".o_shadcn_panel").toHaveCount(1);
    expect(browser.localStorage.getItem("web_theme_shadcn.panel")).toBe("expanded");
});

test.tags("desktop");
test("panel collapses with control+b", async () => {
    await mountWithCleanup(NavBar);
    await press(["control", "b"]);
    await animationFrame();
    expect(".o_shadcn_panel").toHaveCount(0);
});

test.tags("desktop");
test("panel starts collapsed when localStorage says so", async () => {
    browser.localStorage.setItem("web_theme_shadcn.panel", "collapsed");
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_panel").toHaveCount(0);
});

test.tags("desktop");
test("search button opens the command palette", async () => {
    const calls = [];
    patchWithCleanup(NavBar.prototype, {
        setup() {
            super.setup();
            this.command = { openMainPalette: (...args) => calls.push(args) };
        },
    });
    await mountWithCleanup(NavBar);
    await contains(".o_shadcn_search").click();
    expect(calls).toHaveLength(1);
});

test.tags("desktop");
test("desktop brand is a clickable menu item with tour attributes", async () => {
    await makeMockEnv();
    getService("menu").setCurrentMenu(1);
    await mountWithCleanup(NavBar);
    expect('.o_menu_brand[data-menu-xmlid="project.menu_main_pm"]').toHaveCount(1);
    expect(".o_menu_brand").toHaveAttribute("href", "/odoo/action-10");
    expect(".o_menu_brand").toHaveText("Project");
});

test.tags("desktop");
test("panel-collapsed body class is removed on unmount", async () => {
    const navbar = await mountWithCleanup(NavBar);
    await contains(".o_shadcn_panel_toggle").click();
    // `.o_web_client` is the HOOT fixture here (mountWithCleanup adds the class).
    expect(getFixture()).toHaveClass("o_shadcn_panel_collapsed");
    destroy(navbar);
    await animationFrame();
    expect(getFixture()).not.toHaveClass("o_shadcn_panel_collapsed");
    expect(document.body).not.toHaveClass("o_shadcn_panel_collapsed");
});

test.tags("mobile");
test("no rail or panel on small screens; burger sidebar still works", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_rail").toHaveCount(0);
    expect(".o_shadcn_panel").toHaveCount(0);
    expect(".o_menu_toggle").toHaveCount(1);
});

test.tags("desktop");
test("systray has no website class without the website module", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_menu_systray").toHaveCount(1);
    expect(".o_menu_systray").not.toHaveClass("o_website_systray");
});

test.tags("desktop");
test("systray gets the website class when website provides the getter", async () => {
    // `website` adds this getter on the NavBar prototype; without it OWL resolves
    // the name to undefined and the class stays off (test above).
    patchWithCleanup(NavBar.prototype, {
        get shouldDisplayWebsiteSystray() {
            return true;
        },
    });
    await mountWithCleanup(NavBar);
    expect(".o_menu_systray").toHaveClass("o_website_systray");
});

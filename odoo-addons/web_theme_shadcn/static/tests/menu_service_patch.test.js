// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { expect, test } from "@odoo/hoot";
import { defineMenus, getService, makeMockEnv, mockService } from "@web/../tests/web_test_helpers";

test("menu service exposes the current menu id and notifies changes", async () => {
    defineMenus([
        { id: 1, name: "App1", children: [{ id: 11, name: "Sub", appID: 1, actionID: 5 }] },
    ]);
    const env = await makeMockEnv();
    const menu = getService("menu");
    expect(menu.getCurrentMenuId()).toBe(undefined);

    const events = [];
    env.bus.addEventListener("MENUS:CURRENT-CHANGED", () => events.push("changed"));

    menu.setCurrentMenu(11);
    expect(menu.getCurrentMenuId()).toBe(11);
    expect(menu.getCurrentApp().id).toBe(1);
    expect(events).toEqual(["changed"]);

    menu.setCurrentMenu(menu.getMenu(1));
    expect(menu.getCurrentMenuId()).toBe(1);
    expect(events).toEqual(["changed", "changed"]);
});

test("menu service tracks the current menu id on selectMenu navigation", async () => {
    mockService("action", {
        async doAction(action, options) {
            options?.onActionReady?.();
        },
    });
    defineMenus([
        { id: 1, name: "App1", children: [{ id: 11, name: "Sub", appID: 1, actionID: 5 }] },
    ]);
    const env = await makeMockEnv();
    const menu = getService("menu");

    const events = [];
    env.bus.addEventListener("MENUS:CURRENT-CHANGED", () => events.push("changed"));

    await menu.selectMenu(11);
    expect(menu.getCurrentMenuId()).toBe(11);
    expect(menu.getCurrentApp().id).toBe(1);
    expect(events).toEqual(["changed"]);

    // App1 (id 1) has no actionID: the original selectMenu returns early
    // without calling doAction, so no recording should happen either.
    await menu.selectMenu(1);
    expect(menu.getCurrentMenuId()).toBe(11);
    expect(events).toEqual(["changed"]);
});

test("setting an unknown menu id changes nothing", async () => {
    defineMenus([
        { id: 1, name: "App1", children: [{ id: 11, name: "Sub", appID: 1, actionID: 5 }] },
    ]);
    const env = await makeMockEnv();
    const menu = getService("menu");
    menu.setCurrentMenu(11);

    const events = [];
    env.bus.addEventListener("MENUS:CURRENT-CHANGED", () => events.push("changed"));

    menu.setCurrentMenu(999);
    expect(menu.getCurrentMenuId()).toBe(11);
    expect(events).toEqual([]);
});

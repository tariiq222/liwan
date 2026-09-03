// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { patch } from "@web/core/utils/patch";
import { menuService } from "@web/webclient/menus/menu_service";

patch(menuService, {
    async start(env) {
        const service = await super.start(env);
        let currentMenuId;
        const setCurrentMenu = service.setCurrentMenu;
        const selectMenu = service.selectMenu;
        /** resolve `menu` (id or object) and record it; returns the resolved menu */
        const record = (menu) => {
            const menuObj = typeof menu === "number" ? service.getMenu(menu) : menu;
            if (menuObj) {
                currentMenuId = menuObj.id;
                env.bus.trigger("MENUS:CURRENT-CHANGED");
            }
            return menuObj;
        };
        return Object.assign(service, {
            setCurrentMenu(menu) {
                setCurrentMenu.call(service, menu);
                record(menu);
            },
            async selectMenu(menu) {
                await selectMenu.call(service, menu);
                const menuObj = typeof menu === "number" ? service.getMenu(menu) : menu;
                if (menuObj?.actionID) {
                    record(menuObj);
                }
            },
            getCurrentMenuId() {
                return currentMenuId;
            },
        });
    },
});

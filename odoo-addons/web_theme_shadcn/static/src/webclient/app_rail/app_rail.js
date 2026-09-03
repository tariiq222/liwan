// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { Component } from "@odoo/owl";

export class AppRail extends Component {
    static template = "web_theme_shadcn.AppRail";
    static props = {
        apps: Array,
        currentApp: { type: Object, optional: true },
        onSelect: Function,
        getHref: Function,
    };

    onClick(ev, app) {
        ev.preventDefault();
        this.props.onSelect(app);
    }
}

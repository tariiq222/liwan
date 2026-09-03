// Part of Odoo. See LICENSE file for full copyright and licensing details.

import { Component, onWillUpdateProps, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";

export class AppPanel extends Component {
    static template = "web_theme_shadcn.AppPanel";
    static props = {
        app: { type: Object, optional: true },
        sections: Array,
        currentMenuId: { type: Number, optional: true },
        onSelect: Function,
        getHref: Function,
    };

    setup() {
        this.state = useState({
            open: new Set(this.ancestorsOf(this.props.currentMenuId, this.props.sections)),
        });
        onWillUpdateProps((next) => {
            for (const id of this.ancestorsOf(next.currentMenuId, next.sections)) {
                this.state.open.add(id);
            }
        });
    }

    get ariaLabel() {
        return this.props.app ? this.props.app.name : _t("Menu");
    }

    /** ids of every group node on the path from the root down to (not including) `menuId` */
    ancestorsOf(menuId, nodes, path = []) {
        if (!menuId) {
            return [];
        }
        for (const node of nodes) {
            if (node.id === menuId) {
                return path;
            }
            if (node.childrenTree.length) {
                const found = this.ancestorsOf(menuId, node.childrenTree, [...path, node.id]);
                if (found.length) {
                    return found;
                }
            }
        }
        return [];
    }

    isOpen(node) {
        return this.state.open.has(node.id);
    }

    toggle(node) {
        if (this.state.open.has(node.id)) {
            this.state.open.delete(node.id);
        } else {
            this.state.open.add(node.id);
        }
    }

    hotkeyFor(index, depth) {
        // matches upstream: 1…9 then 0 for the 10th entry
        return depth === 0 && index < 10 ? String((index + 1) % 10) : undefined;
    }

    onClick(ev, node) {
        ev.preventDefault();
        this.props.onSelect(node);
    }
}

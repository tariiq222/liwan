# Product

<!-- impeccable:product-schema 1 -->

UI authority: [DESIGN.md](../../DESIGN.md). This file is product scope, not a theme.

## Platform

web

## Users

Confirmed: a customer **company and its employees**. Nasq is used inside the institution, not as a consumer app.

Roles inside that company (from shipped routes, not a ranked persona): project managers and PMO staff, task assignees, meeting participants, HR directory operators, and account/permission administrators.

## Product Purpose

نَسَق (Nasq) is a resellable project and task management product. Each customer has an independent deployment, database, Odoo 19 instance, and Nuxt customer UI; there is no shared tenant layer. Success means employees can run projects, tasks, meetings, HR directory work, and access settings in Nasq without using the vendor Odoo console.

## Positioning

Confirmed mechanisms a neighboring product cannot copy by renaming screens:

1. Operational independence: one database, Odoo, and frontend per customer.
2. Arabic RTL-first customer UI as the employees’ workplace; the Odoo backend remains the vendor console (`web_theme_shadcn`), not the staff product.

Commercial slogans, pricing, and competitive claims stay undecided.

## Operating Context

- Customer UI: `apps/web` (Nuxt 4) talking to Odoo through `/api/v1`.
- Engine: Odoo 19 CE. Pillars: `nasq_core` (capabilities/identity), `nasq_pmo` (projects/tasks), `nasq_hr` (directory), `nasq_api` (shared HTTP). Meetings extend `cyan_meeting_minutes` through `nasq_pmo`.
- HR records live at `/hr`. Account grants live at `/settings/users`. `/api/v1/people` remains the PMO user-id picker; employee ids and user ids stay distinct.
- Customer-specific behavior belongs in a `customer_<name>_*` overlay, never in core pillars.

## Capabilities and Constraints

- PMO: projects, tasks, schedules, templates, milestones, dependencies, stakeholders, RACI, register, finance/costs, updates, attachments, archive/restore, notifications.
- Meetings: list, calendar, recurring series, minutes; print stays outside the record sheet.
- Chat: conversation workspace (not the record-sheet recipe).
- HR: employees, departments/org, documents. No payroll or time logging.
- Settings: appearance, users, roles, access log, institution branding (primary-only in the customer UI; ignore the backend's legacy `secondary_color` field; name and logo remain Odoo system-admin).
- Authorization is capability-based, not role-name-based.
- Default locale Arabic / RTL-first; English secondary. Business screens are real routes: direct link, refresh, back with list filters. Overlay exceptions: global search dialog, notification popover (latest five, then `/notifications`), unsaved-draft guard, value-selection menus, inline destroy confirm. Do not stack business dialogs.
- Presentation follows DESIGN.md; contracts and security in `../../CLAUDE.md` are not visual.

## Brand Commitments

Name: نَسَق (Nasq). Binding UI constitution: [DESIGN.md](../../DESIGN.md). This file does not define a second theme.

## Evidence on Hand

- Routes and copy: `app/pages/`, `i18n/locales/{ar,en}/`.
- Product boundaries: `../../CLAUDE.md`, `../../AGENTS.md`.
- Do not fabricate testimonials, metrics, pricing, or deploy approvals.

## Product Principles

1. Each customer is operationally and data-independent.
2. Employees work in Nasq; the vendor console is not the product.
3. Projects and tasks are the core domain; HR is a separate directory.
4. Capability and record/company context gate every action.
5. Work screens are addressable: link, refresh, back, filters.

## Accessibility & Inclusion

Product requirements already binding in DESIGN.md: Arabic RTL-first and English LTR, three appearance modes, three type sizes, keyboard use, reduced motion, text contrast ≥ 4.5:1 and fill ≥ 3:1. No additional inclusion standard was confirmed.

## Open Decisions

- First-run persona inside the company (which employee job the empty states speak to first).
- Commercial differentiation beyond the two confirmed mechanisms.

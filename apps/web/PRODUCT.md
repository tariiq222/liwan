# Product

<!-- impeccable:product-schema 1 -->

UI authority: [DESIGN.md](../../DESIGN.md). This file defines product vision
and distinguishes it from current implementation scope; it is not a theme.
The product definition below was explicitly approved by the owner on 2026-09-30.

## Platform

web

## Users

Confirmed: a customer **company and its employees**. WebVue is used inside the institution, not as a consumer app.

The vision serves companies across business functions and industries. The
currently implemented roles below do not limit the long-term audience to PMO
or HR teams.

Roles inside that company (from shipped routes, not a ranked persona): project managers and PMO staff, task assignees, meeting participants, HR directory operators, and account/permission administrators.

## Product Purpose

**ويب فيو منصة عربية موحّدة لتشغيل الشركات، تكون الأساس المشترك لجميع تطبيقاتها،
وتربط بياناتها وإجراءاتها وصلاحياتها في نظام واحد.** بدل اشتراك الشركة في أنظمة
متعددة معزولة وتكرار البيانات وبناء تكاملات بينها، تبدأ بما تحتاجه في ويب فيو وتتوسع
تدريجيًا، بهدف خفض التكلفة الإجمالية للاشتراكات والتكامل والتشغيل.

WebVue aims to cover company operations with a breadth comparable to Odoo,
under its own identity and customer experience. The vision includes sales,
finance, purchasing, inventory, HR, projects, and other business applications
on a common foundation. PMO and HR are initial applications within that
platform, not its complete definition or permanent boundary.

Product success means connected work across departments, less duplicate data
entry and integration effort, and lower total cost than fragmented systems.
These are objectives to validate, not claims that every application is already
available or that savings have been measured. Existing capabilities and
delivery constraints remain distinct from this vision.

## Positioning

Owner-approved positioning:

1. One business platform with connected applications, data, workflows, and
   permissions, replacing fragmented subscriptions and isolated systems.
2. Arabic RTL-first customer experience under WebVue's identity, built on Odoo
   Community as the business engine.
3. Progressive adoption: companies use the applications they need and expand
   as their needs grow.
4. Lower total subscription, integration, and operating cost as a measurable
   objective. No specific price, savings percentage, or universal cost
   advantage is established by this definition.

Detailed packaging, pricing, rollout order, and comparative savings evidence
remain to be established. A shared platform means connected work inside each
company; it does not permit sharing data between customer companies.

## Operating Context

- Customer UI: `apps/web` (Nuxt 4) talking to Odoo through `/api/v1`.
- Engine: Odoo 19 CE. Pillars: `webvue_core` (capabilities/identity), `webvue_pmo` (projects/tasks), `webvue_hr` (directory), `webvue_api` (shared HTTP). `webvue_meetings` owns the meeting engine and links to projects through the bridge `webvue_meetings_pmo`.
- Primary hosting target: self-service SaaS on shared application services,
  with a separate database and filestore per customer. Managed dedicated and
  customer-hosted deployments remain separate options. See the
  [hosting contract](../../docs/superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md)
  and [delivery evidence](../../docs/WORKSPACE.md); local integration is not
  production or release approval.
- HR records live at `/hr`. Account grants live at `/settings/users`. `/api/v1/people` remains the PMO user-id picker; employee ids and user ids stay distinct.
- Customer-specific behavior belongs in a `customer_<name>_*` overlay, never in core pillars.

## Current Capabilities and Delivery Constraints

This inventory describes the implemented scope, not the full product vision.
Deferred applications require their own scoped implementation and acceptance;
updating the definition does not implement or authorize them automatically.

- PMO: projects, tasks, schedules, templates, milestones, dependencies, stakeholders, RACI, register, finance/costs, updates, attachments, archive/restore, notifications.
- Meetings: list, calendar, recurring series, minutes; print stays outside the record sheet.
- Chat: conversation workspace (not the record-sheet recipe).
- HR: employees, departments/org, documents. No payroll or time logging.
- Settings: appearance, users, roles, access log, institution branding (primary-only in the customer UI; ignore the backend's legacy `secondary_color` field; name and logo remain Odoo system-admin).
- Authorization is capability-based, not role-name-based.
- Default locale Arabic / RTL-first; English secondary. Business screens are real routes: direct link, refresh, back with list filters. Overlay exceptions: global search dialog, notification popover (latest five, then `/notifications`), unsaved-draft guard, value-selection menus, inline destroy confirm. Do not stack business dialogs.
- Presentation follows DESIGN.md; contracts and security in `../../CLAUDE.md` are not visual.

## Brand Commitments

Name: ويب فيو (WebVue). Binding UI constitution: [DESIGN.md](../../DESIGN.md). This file does not define a second theme.

## Evidence on Hand

- Routes and copy: `app/pages/`, `i18n/locales/{ar,en}/`.
- Product boundaries: `../../CLAUDE.md`, `../../AGENTS.md`.
- Do not fabricate testimonials, metrics, pricing, or deploy approvals.

## Product Principles

1. Customer data stays isolated even when application services are shared.
2. Employees work in WebVue; the WebVue vendor administration (`apps/vendor-admin`) is a separate staff application, not part of this product.
3. Business applications share a coherent platform; PMO and HR are initial
   domains, with their own contracts, within the broader product vision.
4. Capability and record/company context gate every action.
5. Work screens are addressable: link, refresh, back, filters.
6. Prefer connected workflows and reuse of existing Odoo business capabilities
   over recreating isolated systems or duplicating business data.
7. Keep vision, implementation evidence, and measured cost outcomes explicit.

## Accessibility & Inclusion

Product requirements already binding in DESIGN.md: Arabic RTL-first and English LTR, three appearance modes, three type sizes, keyboard use, reduced motion, text contrast ≥ 4.5:1 and fill ≥ 3:1. No additional inclusion standard was confirmed.

## Open Decisions

- First-run persona inside the company (which employee job the empty states speak to first).
- Application rollout order, commercial packaging and pricing, and evidence
  for total-cost comparisons against fragmented systems.

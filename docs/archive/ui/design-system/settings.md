> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Settings page pattern

> تاريخي. السياسة: [DESIGN.md](../../../../DESIGN.md). قائمة الإعدادات المسطحة وترتيب الروابط هناك، لا هنا.

SettingsLayout owns the internal navigation and a content container that sizes
filters and choice grids by available space, including alongside the app sidebar.
Lists use the full content column; form pages use `nasq-settings-form-page` (900px).

- Five sections: Appearance, Projects, Users, Roles, Access log. The app sidebar
  has one Settings entry at the bottom; detailed links live in SettingsTabs.
- Appearance contains personal mode/font controls and a capability-gated company
  colour panel. Personal preferences save automatically in the browser; colour
  changes still require explicit saving. `/settings/branding` redirects to
  `/settings/appearance#branding` for existing links.
- Filter panels use labelled fields, 40px inputs/selects, a full-width search,
  and a separated reset action. Fields stack when two readable controls cannot fit;
  from 640px of content width they use three columns. Tables scroll inside their panel.
- Forms use the common panel, 18px padding, 16px grids, 20px section/footer
  spacing, and responsive choice lists. Colour and focus states use theme tokens.
- Permissions, read-only states, route filters, confirmation flows, and colour-only
  company branding ownership retain their existing contracts.

Coverage: `settings-layout.spec.ts` checks the settings routes in dark mode with
large text at desktop and phone sizes, including control dimensions and overflow.
`appearance.spec.ts`, `branding.spec.ts`, and `access-admin.spec.ts` cover saves,
preference persistence, failures and authorization workflows.

# الرجوع إلى شكل Nuxt UI v4 الافتراضي

التاريخ: 2026-09-14. الحالة: معتمد من المستخدم («نفّذ») بعد اختيار B.

## القرار

واجهة `apps/web` تعود إلى **الشكل الافتراضي لمكتبة Nuxt UI v4** كما في ملف Figma الرسمي «Nuxt UI v4 (Community)». مصدر الحقيقة الشكلي هو وصفات المكتبة نفسها؛ لا وصفات مخصصة للمكوّنات في `app.config.ts` ولا كلاسات `nasq-ui-*` تعيد رسم عناصر المكتبة.

يبقى: الغلاف الأساسي (`shell.css`: الهيدر، شريط الموديولات، القائمة السياقية، عرض الصفحات)، اشتقاق `primary` من لون الهوية في الإعدادات (`brandTheme.ts`)، خط IBM Plex Sans Arabic، RTL، الأوضاع الثلاثة، المسارات والصلاحيات والفلاتر وحماية المسودات، وقاعدة «Storybook هو مصدر المكوّنات الملزم».

## الخطوة 1 — الرجوع

`git revert --no-commit 80df4a7^..3733273` (كومتات تحديث Stripe/ClickUp التسعة) ثم كومت واحد. يُعاد بعده يدويًا **فقط** ما يخص قاعدة Storybook الملزمة في DESIGN.md وCLAUDE.md وAGENTS.md و`.claude/agents/frontend-theme.md` و`docs/design-system/components.md` و`docs/design-system/nuxt-ui-reference.md` و`tools/ui_policy.py` (التعليق)، بصياغتها من الكومت 821df3b بلا ذكر هندسة Stripe.

## الخطوة 2 — الثيم الافتراضي

- `app.config.ts`: يحتوي `colors: { primary: 'brand', neutral: 'slate' }` وطبقات z-index للمحتوى العائم (`selectMenu/select/dropdownMenu/tooltip/popover/slideover/modal` → `z-[var(--nasq-ui-z-menu)]`/`z-[var(--nasq-ui-z-sheet)]`) فقط. لا slots للحجم أو الزوايا أو الظلال أو الحشو أو الجدول أو البطاقة أو الشارة.
- `tokens.css`: يبقى `@theme` لأحجام الخط والخط، ولوحة `--color-brand-*` المشتقة من `--primary`، وتوكنات الرسوم `--chart-*`، وz-index. تُحذف `--nasq-radius`/`--radius`، `--elevation-*`، `--content-shadow`، وتجاوزات `--ui-bg/--ui-border/--ui-text` في الوضع الفاتح (المكتبة تولّدها من `slate`). الكريمي والداكن يبقيان كتجاوزات محدودة لـ`--ui-bg*` و`--ui-text*` و`--ui-border*` فقط. `--ui-radius` لا يُعرَّف (افتراضي المكتبة).
- `components.css`: تُحذف وصفات المكوّنات (`nasq-ui-primary-solid`, `nasq-ui-primary-text`, `nasq-ui-field`, `nasq-ui-icon-button`, `nasq-ui-selected`, `nasq-ui-calendar`, `nasq-ui-filter-row`, `nasq-ui-date-trigger`, `nasq-ui-card-header`, `nasq-ui-table-head`, `nasq-ui-record-surface`, `nasq-ui-metric-icon`, `nasq-ui-tab-strip/tab`, `nasq-ui-subtab-row`, `nasq-ui-segment`, `nasq-ui-progress`, `nasq-elevation-*`, `[data-nasq-reference-detail]`). تبقى قواعد الغلاف (القائمة الجوالة، شريط الموديولات، التركيز الدلالي للروابط، الأيقونات 18px، التمرير والتحديد، `nasq-status-*` الدلالية).
- الاستبدال في الصفحات والمكوّنات:
  | القديم | البديل الافتراضي |
  |---|---|
  | `nasq-ui-record-surface` | `UCard :ui="{ body: 'p-0' }"` للجداول والقوائم؛ `UCard` للمحتوى |
  | `nasq-ui-card-header` / `nasq-ui-table-head` | تُحذف (رأس `UCard` و`UTable` الافتراضيان) |
  | `nasq-ui-tab-strip` + `nasq-ui-tab` | `UTabs variant="link"` مع `to` للتبويبات الموجّهة |
  | `nasq-ui-subtab-row` | `UTabs variant="pill" size="sm"` |
  | `nasq-ui-segment` | `UButtonGroup` مع `UButton variant="subtle/ghost"` |
  | `nasq-ui-selected` / `tr[data-selected]` | `data-[selected=true]:bg-primary/10` الافتراضي في `UTable` |
  | `nasq-ui-icon-button` | `UButton square` بلا كلاس |
  | `nasq-ui-metric-icon` | `UAvatar`/`UIcon` داخل `UCard` |
  | `nasq-ui-progress` + `--nasq-ui-progress` | `UProgress` بقيمته مباشرة |
  | `nasq-ui-filter-row` | `UCard` |
  | `nasq-elevation-*` | تُحذف |
- `shell.css`: يبقى كما هو باستثناء إزالة `box-shadow: var(--content-shadow)` والاعتماد على `border` الافتراضي.
- الخط: `IBM Plex Sans Arabic` في `@font-face` و`--font-sans` يبقى.

## الخطوة 3 — التوثيق والقصص والاختبارات

- DESIGN.md §1 و§2 و§6: «الشكل = Nuxt UI v4 الافتراضي (Figma الرسمي). التخصيص الوحيد: `primary` من لون الهوية، `neutral: slate`، الخط العربي، الأوضاع الثلاثة. لا وصفة مكوّن مخصصة؛ أي حاجة تخصيص لاحقة تُضاف في `app.config.ts` فقط وتُوثَّق هنا».
- `docs/design-system/components.md`: تُحذف الوصفات `nasq-ui-*` من الفهرس.
- القصص `Foundations/Shape` و`Nuxt UI/*` تعرض الافتراضيات؛ وصف القصص يُحدَّث.
- اختبارات التصميم التي تثبّت `nasq-ui-*` تُحدَّث لتثبّت البدائل.

## التحقق

`python3 -B tools/ui_policy.py`، `npm test`، `npx -w apps/web vue-tsc --noEmit` (+ `.storybook/tsconfig.json`)، `npm -w apps/web run build-storybook` + smoke، لقطات mock stack لـ`/projects`، `/tasks`، `/tasks/:id`، `/projects/:id`، `/settings/users` على 1440/390 والأوضاع الثلاثة.

## خارج النطاق

لا تغيير في API أو Odoo أو العقود أو الغلاف أو التنقل.

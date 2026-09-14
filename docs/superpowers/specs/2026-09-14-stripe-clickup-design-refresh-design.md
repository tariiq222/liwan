# تحديث تصميم الواجهة: هندسة Stripe + حالة ClickUp

التاريخ: 2026-09-14. الحالة: معتمد من المستخدم في المحادثة (الخيار C، النطاق C، الترتيب A ثم B).

## القرار

واجهة `apps/web` تنتقل إلى **هندسة Stripe** (زوايا صغيرة، كثافة، حدود بدل ظلال، تسلسل نصي واضح) مع **لون حالة ClickUp** (شارات حالة/أولوية ملوّنة دلاليًا) حيث تهم الحالة فعلًا: المهام والمشاريع.

هذا تعديل في دستور الواجهة [DESIGN.md](../../../DESIGN.md) نفسه، لا استثناء عليه. الأقسام 1 و2 و6 تُحدَّث لتصف الشكل الجديد، والمرجع `~/Downloads/nasq-ui` يبقى «أصل الشكل» التاريخي لا المرجع الملزم.

يبقى بلا تغيير: لون الهوية من `res.company`، الشريط الداكن، مؤشر التنقل العمودي، خط IBM Plex Sans Arabic، RTL أولًا، المظاهر الثلاثة، أحجام الخط الثلاثة، المسارات والصلاحيات والفلاتر وحماية المسودة، Nuxt UI كمكتبة وحيدة.

## قاعدة جديدة ملزمة لكل الوكلاء: Storybook هو مصدر المكوّنات

توجيه المستخدم في 2026-09-14: **كل وكيل (Claude/Codex/Gemini/غيرهم) يأخذ مكوّنات الواجهة من Storybook**.

- قبل بناء أي صفحة أو تعديلها، يُفتح Storybook (`npm -w apps/web run storybook`، منفذ 6006) أو `apps/web/stories/**` ويُعاد استخدام المكوّن الموجود بوصفته الموثقة.
- المكوّن غير الموجود في Storybook ليس لبنة معتمدة. المكوّن المشترك الجديد يُشحن مع قصته قبل استخدامه في صفحة ثانية، ويُضاف إلى `STORYBOOK_COMPONENTS` في `tools/ui_policy.py`.
- لا نسخة محلية من مكوّن له قصة. الاختلاف المطلوب يُضاف كـprop أو variant موثّق في القصة.
- تُحدَّث عبارة DESIGN.md «أداة عرض واختبار، ليست مصدر تصميم» إلى: «فهرس المكوّنات الملزم؛ القرار الشكلي لهذا الملف، واللبنة من Storybook». وتُضاف الفقرة نفسها إلى `AGENTS.md` و`CLAUDE.md` (قسم Frontend) و`.claude/agents/frontend-theme.md` و`docs/design-system/components.md`.

## تشخيص الوضع الحالي (2026-09-14، 224 ملف `.vue`)

| الطبقة | مربوطة بالتوكنات؟ | الدليل |
|---|---|---|
| الألوان | نعم | صفر `bg-zinc-*`; 49 hex منها 37 في `BrandingPreview.vue` (مشروع) والباقي رسوم |
| أحجام الخط | نعم | `text-sm/xs` تقرأ `--text-*` من `tokens.css` |
| الظلال | غالبًا | 4 يدوية؛ الباقي `nasq-ui-record-surface` (107) و`--elevation-*` |
| الزوايا | **لا** | `--nasq-radius: 14px` لا يقرأه أحد؛ 97 كلاس `rounded-*` في 47 ملفًا تأخذ مقياس Tailwind الثابت؛ `--ui-radius` معرَّف مرتين |
| الكثافة | **لا** | ~150 `p-3..p-6` يدوية؛ `min-h-9` في `app.config.ts` فقط |
| CSS محلي | 25 ملف `<style>` | مهام/اجتماعات/HR |

## المرحلة 1 — ربط الهندسة بالتوكنات (طبقة الثيم)

الملفات: `apps/web/app/assets/css/tokens.css`، `components.css`، `shell.css`، `apps/web/app/app.config.ts`، `DESIGN.md`، القصص `foundations/Shape`، `foundations/Colors`، `nuxt-ui/Surfaces`، `nuxt-ui/Actions`.

### الزوايا
في `tokens.css` داخل `@theme`:
```
--radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 10px; --radius-2xl: 12px;
```
و`--nasq-radius: 8px`، و`--ui-radius: 6px` بتعريف واحد (يُحذف `.4rem`). `rounded-full` تبقى للصور الرمزية والنقاط والعدّادات فقط. `SettingsLayout.vue` يستخدم `--radius-xl` فيتبع تلقائيًا.

### الكثافة
- التحكم: `min-h-8` (32px) في وصفات `button/input/inputNumber/selectMenu/…` في `app.config.ts`؛ `.nasq-ui-icon-button` 32px؛ الجوال يبقى 44px.
- صف الجدول 40px، خلية `px-3 py-2`. رأس الجدول: `text-xs` مساند وزن 500، خلفية `--ui-bg-muted`، حد سفلي.
- حشو الصفحة `20px 24px 40px` (بدل `22px 28px 42px`). `.nasq-page-stack` gap 1.25rem.
- `.nasq-ui-filter-row` حشو `0.5rem 0.75rem`.

### الحدود والظلال
- `.nasq-ui-record-surface`: حد `1px solid var(--ui-border)` بلا `box-shadow`. `--elevation-1` يبقى للأزرار الأساسية الممتلئة فقط.
- `--elevation-2` للـpopover، `--elevation-3` للقوائم، `--elevation-4` للنوافذ. لا ظل على بطاقات المحتوى.
- `--nasq-surface-hover: #f1f3f9` (فاتح)، مشتق في الكريمي والداكن. صف الجدول `:hover` يستخدمه؛ الصف المختار يبقى `--primary-soft`.

### النص
- تسميات الحقول والأعمدة: `text-xs` مساند وزن 500 (`.nasq-ui-label`).
- العناوين: H1 `text-xl` وزن 600؛ عنوان القسم `text-base` وزن 600؛ الوصف تحت العنوان `text-sm` مساند.
- `tabular-nums` على `RecordNumber` وخلايا الأرقام والتواريخ (`.nasq-ui-num`).

### شارة الحالة (العنصر المميز)
وصفة `nasq-ui-status-pill` في `components.css`: `inline-flex`، ارتفاع 22px، حشو `0 8px`، زاوية `--radius-md`، `text-xs` وزن 500، نقطة 6px قبل النص، خلفية `color-mix(tone 12%, card)`، نص `tone` داكن، حد `color-mix(tone 24%, border)`.

توكنات دلالية ثابتة (لا ترث لون المؤسسة، ولها قيم للأوضاع الثلاثة):
```
--state-in-progress (أزرق) --state-changes-requested (برتقالي) --state-approved (بنفسجي)
--state-waiting (رمادي) --state-done (أخضر) --state-cancelled (رمادي داكن)
--priority-urgent (أحمر) --priority-high (برتقالي) --priority-normal (أزرق) --priority-low (رمادي)
```
`StateBadge` و`ProjectStatusBadge` و`DeadlineBadge` و`PrioritySelect` تستخدم الوصفة عبر `UBadge` بـ`class` ولون من `STATUS_COLOR`/خريطة الحالة، مع الاحتفاظ بـ`data-testid` والنصوص المترجمة. `statusTone.ts` يبقى مالك الخريطة؛ يُضاف إليه `STATE_PILL_VAR`.

### DESIGN.md
- §1: نصف القطر 8px (تحكم 6px)، الظل للطبقات العائمة فقط، حاوية `20px 24px 40px`، Storybook مصدر المكوّنات.
- §2: يُضاف صف «الحالة/الأولوية» بلون دلالي ثابت وشارة `nasq-ui-status-pill`.
- §6: تحكم 32px، جدول 40px بـhover، رأس 12px، تسميات 12px، أرقام جدولية.

### التحقق
`python3 -B tools/ui_policy.py`، `npm test`، `npx -w apps/web vue-tsc --noEmit`، `npx -w apps/web vue-tsc --noEmit -p .storybook/tsconfig.json`، Storybook: لقطات `Shape`/`Colors`/`Surfaces`/`Actions`/`Fields` قبل/بعد، ثم صفحات `/projects` و`/tasks` عبر mock stack على 390/768/1440 والمظاهر الثلاثة.

## المرحلة 2 — المكوّنات المشتركة الستة

الملفات: `shared/FilterBar.vue`، `shared/FilterCard.vue`، `shared/FilterChip.vue`، `shared/PageHeader.vue`، `task/TaskCard.vue`، جدول السجلات (وصفة `nasq-ui-table` + `UTable` في `app.config.ts`)، الشارات الأربع، قصصها.

- **PageHeader**: عنوان + وصف في سطر واحد بارتفاع 40px، الإجراءات في الطرف المقابل بحجم 32px؛ الإجراء الرئيسي واحد ممتلئ، الباقي outline. لا حد سفلي؛ الفاصل هو الـtoolbar.
- **FilterBar/FilterCard** (Stripe toolbar): صف واحد 40px: بحث 280px + زر «فلاتر» outline بعدّاد + الشرائح النشطة inline + مسح، والنطاق/مبدّل العرض في النهاية. صف الفلاتر المفتوح يظهر **تحت الشريط بلا بطاقة** (حد علوي فقط)، حقول 32px بتسميات 12px. لا بطاقة فارغة.
- **الجدول**: `nasq-ui-table` — صف 40px، hover، عمود الرقم أولًا ثابت عند التمرير الأفقي، عمود إجراءات أخير يظهر عند المرور/التركيز (`.nasq-ui-row-actions`، مرئي دائمًا عبر لوحة المفاتيح وفي الجوال).
- **TaskCard** (ClickUp): حد hairline، زاوية 8px، بلا ظل؛ العنوان `text-sm` 500؛ سطر meta واحد: شارة الحالة/الموعد + الصور الرمزية 20px؛ زر «…» يظهر عند المرور/التركيز؛ شريط لون 3px على بداية البطاقة بلون الأولوية عند وجودها.
- **الشارات**: تعتمد `nasq-ui-status-pill` من المرحلة 1.

كل مكوّن يُحدَّث مع قصته وتُضاف حالات hover/focus كقصص. الاختبارات الموجودة (`__tests__`) تُحدَّث لا تُحذف.

## المرحلة 3 — قوالب الصفحات

### 3أ — قالب القائمة: `/projects` ثم `/tasks`
- ترتيب: `PageHeader` → toolbar (FilterBar) → جدول/لوحة داخل `nasq-ui-record-surface` واحد → ترقيم أسفل داخل السطح.
- `/projects`: الجدول الافتراضي (رقم، اسم، حالة pill، مدير، تقدم، تاريخ، إجراءات) وبطاقات في الجوال. لا أزرار عائمة (القرار `a496b25`).
- `/tasks` (`?view=list|board`): القائمة جدول كثيف؛ اللوحة أعمدة 280px بعناوين حالة pill وعدّاد، بطاقات `TaskCard`.
- الفلاتر والعرض في الرابط كما هي؛ الرجوع يحفظها.

### 3ب — قالب السجل: `/projects/:id` ثم `/tasks/:id`
- عمودان على ≥1024px: المحتوى (`minmax(0,1fr)`) وعمود خصائص ثابت 300px في **نهاية** القراءة (يسار العربية) بحد بداية. تحت 1024px يصبح العمود قسمًا قابلًا للطي فوق المحتوى.
- عمود الخصائص: قائمة `dl` بتسميات 12px وقيم 14px (الحالة pill، المكلّفون، الموعد، الأولوية، الوسوم، المشروع الأب). التعديل داخل السطر عبر المكوّنات الموجودة (`StateMenu`، `PrioritySelect`، `TagPicker`، `DateField`).
- المحتوى: العنوان H1 ثم الوصف ثم المهام الفرعية ثم المرفقات ثم التعليقات، كل قسم `SharedFormSection` بعنوان 16px.
- `/projects/:id`: إطار المشروع وصف التبويبات كما في DESIGN.md §4؛ الملخص عمودان: مؤشرات + رسوم يمين، خصائص المشروع في العمود الجانبي.
- الملفات ذات `<style>` المحلي في المسار (`TaskDetailPanel`، `TaskDetails`، `SubtaskList`، `TaskAttachments`، `CommentComposer`، `ProjectOverview`) تُنقل زواياها وحشوها إلى التوكنات/الوصفات المشتركة؛ يبقى CSS المحلي لما هو خاص بالمكوّن فقط.

## خارج النطاق
الإعدادات وHR والاجتماعات والمحادثات تكسب المرحلة 1 تلقائيًا ولا تُعاد هيكلتها هنا. لا تغيير في API أو العقود أو Odoo. لا مكتبة واجهات ثانية.

## المخاطر
- **الأوضاع الثلاثة**: كل توكن جديد يحتاج قيمة للكريمي والداكن؛ تُفحص بالتباين ≥ 4.5:1 للنص.
- **اختبارات التصميم** (`*Design.test.ts`) تثبّت كلاسات حالية؛ تُحدَّث في نفس المهمة لا تُعطَّل.
- **الزوايا عبر `@theme`** تغيّر Nuxt UI أيضًا (قوائم/نوافذ)؛ مقصود، ويُراجع بصريًا في `Overlays`.
- **Escape/رجوع/فلاتر** في السجل ثنائي العمود يجب أن تبقى كما هي (DESIGN.md §5).

## التنفيذ
worktree `codex/design-refresh` من `main` الحالي. مرحلة واحدة = فرع مراجعة واحد؛ لا يُدمج شيء ولا يُدفع بلا إذن. الخطة التفصيلية في `docs/superpowers/plans/`.

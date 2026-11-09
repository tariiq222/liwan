# تشغيل مرحلة `e2e-odoo` على Odoo حقيقي بعد ترحيل كل الـspecs

التاريخ: **2026-11-08/09**، ومحدَّث **2026-11-09**. النتيجة: **أربعة عشر ملفًا من أربعة عشر تُشغَّل، ولم يبقَ أي ملف مستثنى**. القضية: #576.

## المصدر والبيئة

- المصدر: فرع `codex/tools-e2e-odoo-specs` من `main` عند `3a9a79ddd70e4e9bbfcd66528bc7481400e90154`، مع تعديلات الفرع غير الملتزمة وقت التشغيل (الـspecs والمشتركات والـfixture و`deploy/ci/e2e-odoo.sh` و`docs/testing.md`). لم يُغيَّر أي كود منتج.
- الجهاز: macOS محلي، PostgreSQL محلي، Odoo من `/Users/tariq/code/odoo` بمنفذ **8172**، وبناء إنتاج لـ Nuxt على المنفذ **44300**.
- القاعدة: `liwan_scratch_e2e` فقط. أنشأها السكربت وحذفها عند الانتهاء. لم يُلمس `liwan_dev` ولا `odoo19`.
- الأمر المُلزِم (السكربت نفسه، كما في CI):
  `PGPASSWORD= ODOO_ROOT=/Users/tariq/code/odoo ODOO_PYTHON=/Users/tariq/code/odoo/.venv/bin/python ODOO_PORT=8172 PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tariq bash deploy/ci/e2e-odoo.sh`
  عبر `/Users/tariq/.local/bin/agent-local-load heavy`. (الغلاف المحلي في الفقرات أدناه استُخدم أثناء الترحيل لإعادة تشغيل ملف واحد بلا إعادة بناء المكدس؛ النتيجة المعتمدة أدناه من السكربت الحقيقي.)
- لا نداء لنموذج ولا مفتاح API. عامل Playwright واحد.

## النتيجة النهائية

تشغيل `deploy/ci/e2e-odoo.sh` الحقيقي على قاعدة مؤقتة جديدة (2026-11-09، بعد إعادة الرحلات الأربع): **84 اختبارًا، 80 نجحت، 4 تخطّت بصدق، 0 فشل، 0 لم تُنفَّذ، في دقيقتين و6 ثوانٍ للـspecs**. ثم حرّر السكربت المنفذين وحذف القاعدة؛ التحقّق بعد التشغيل: لا مستمع على 44300 أو 8172، ولا قاعدة `liwan_scratch_e2e`، ولا نسخة من `fixtures.json`.

التوزيع لكل ملف (النجاح/التخطّي): `real-odoo-acceptance` 31/0، `projects-phase2` 13/0، `project-admin` 9/0، **`access-admin` 6/4**، `hr-leave` 5/0، `real-odoo-services` 4/0، `task-lifecycle` 2/0، `realtime` 2/0، `notifications` 2/0، `board` 2/0، وواحد لكلٍّ من `hr-people-access` و`appearance-user` و`activity` و`account`. الاختبارات الأربعة المتخطّاة هي بعينها الرحلات الأربع التي تحتاج جلسة حساب مدعو، والمعلَّلة بـ`test.skip(!MAIL_OUTBOX, NEEDS_INVITEE_SESSION)`.

قبل ذلك جرى نفس التجميع عبر غلاف محلي يُبقي الخادمين، وبعد إعادة الرحلات الأربع: **10 من 10 في `access-admin.spec.ts` عندما يُضبط `E2E_MAIL_OUTBOX`** (sink بريد محلي، خارج المستودع)، و**6 نجاح + 4 تخطٍّ** بلا بنك بريد — وهو شكل المرحلة في CI، ويثبت أن التخطّي سببه غياب الجلسة لا كسر الاختبار.

تحذير تشغيلي لاحظته في الغلاف المحلي: إذا بقي خادم Nuxt يتيم على 44300 من دورة سابقة، يموت البناء الجديد بـ`EADDRINUSE` بينما يجيب الخادم القديم عن قاعدة أُعيد إنشاؤها، فتفشل معظم الاختبارات لأسباب لا علاقة لها بالكود. `deploy/ci/e2e-odoo.sh` يرفض البدء إذا كان المنفذ مشغولًا، فالمشكلة لا تصيبه.

| الملف | الاختبارات | لماذا كان يفشل قبل الترحيل |
| --- | --- | --- |
| `real-odoo-acceptance.spec.ts` | 31 | كان ينجح؛ أُعيد على المشترك الجديد |
| `real-odoo-services.spec.ts` | 4 | كان ينجح؛ أُعيد على المشترك الجديد |
| `access-admin.spec.ts` | 10 (6 تنجح، 4 تتخطى بصدق) | `admin`/`admin` بخطوة واحدة، وموضعان تغيّرا في المنتج (قائمة إجراءات الدور، حالة الدعوة) |
| `account.spec.ts` | 1 | `admin`/`admin`، وكان يقرأ `200` من `/api/auth/login` كجلسة كاملة |
| `activity.spec.ts` | 1 | `admin`/`admin` |
| `appearance-user.spec.ts` | 1 | `admin`/`admin`، وعيب منتج في مسار الخروج (أدناه) |
| `board.spec.ts` | 2 | `admin`/`admin`، والعنوان والتجميع صارا `مهام المشاريع` و`?group=stage` |
| `hr-leave.spec.ts` | 5 | حسابات `staff`/`hrmgr`/`leaveconfig` لا ينشئها الـseed، ولا رصيد إجازة لأي موظف |
| `hr-people-access.spec.ts` | 1 | `admin`/`admin`، وأرشفة موظف بلا تاريخ خروج مرفوضة (422 `departure_missing`) |
| `notifications.spec.ts` | 2 | `admin`/`admin`، و`notification-count` عنصران، والعدّاد تالٍ عربيًا لا رقمًا |
| `project-admin.spec.ts` | 9 | `admin`/`admin`، و`?tab=` متقاعد، والمعالم أداة `planning` اختيارية |
| `projects-phase2.spec.ts` | 13 | حسابات `phase2_*` غير موجودة، وشكل `FinanceSummary` تغيّر، والمصروف اليدوي صار مرفوضًا |
| `realtime.spec.ts` | 2 | `admin`/`admin` |
| `task-lifecycle.spec.ts` | 2 | `admin`/`admin`، والاعتماديات أداة `planning` اختيارية، والأرشيف `?scope=archived` |

## ما يُتخطّى بصدق ولماذا

بعد المراجعة المستقلة ظهر أن أربعة اختبارات في `access-admin.spec.ts` كانت تُضعِف نفسها بنفسها: صارت تفحص الـAPI فقط، وحُذف نصفها الخاص بالمتصفح مع تعليق «Not run here» — أي أن تأكيدات (صفحة `/settings/team/users`، وتحويل `/hr/employees/<id>/access`، و403 على `/api/v1/admin/users`، و`PATCH /api/v1/me`، وحالة الدعوة) اختفت بصمت. أُعيدت الرحلات الأربع كاملة، بنصفها البرمجي والنصف الآخر لمتصفح المدعو، والنصف البرمجي **يعمل في كل بناء**. النصف البرمجي للمتصفح يحتاج جلسة لحساب أنشأه هذا الملف، وهو ما لا تصدره هذه المكدسة (لا بنك بريد، والحساب المدعو لا يملك جهازًا موثوقًا)؛ لذلك يتخطّى **بالاسم** عبر `test.skip(!MAIL_OUTBOX, NEEDS_INVITEE_SESSION)` بدل حذف أي تأكيد.

حُدِّق التخطّي محليًا لا على الورق: شُغّل sink بريد محلي (SMTP بسيط خارج المستودع) وضُبط `mail.default.from`، ثم شُغّلت **الملفات الأربعة كلها بـ`E2E_MAIL_OUTBOX` فنجحت الاختبارات العشرة من عشرة** — أي أن النصف البرمجي صحيح، وليس ادّعاءً. بلا `E2E_MAIL_OUTBOX` (وهو حال `deploy/ci/e2e-odoo.sh`) تعطي نفس المجموعة **6 تنجح و4 تتخطى بصدق**. وساعد هذا التحقق على إصلاح ثلاثة افتراضات قديمة في تلك الرحلات: الهبوط بعد الدخول صار `/` لا `/settings/team/users`، والجلسة الموقوفة تُرفض بـ401 لا 403، ومحرر الدور صار صفحة كاملة بلا شريط حفظ.

أما `appearance-user.spec.ts` فقد أُعيد إلى تأكيده الحقيقي `toHaveURL(/\/login/)` بعد إصلاح عيب الخروج أعلاه، وحُذف تعليق `testInfo.annotations` الذي كان يسجّل مسار الهبوط بدل فحصه.

## ما تغيّر

- **`apps/web/e2e/support/realOdooSession.ts` (جديد)**: مساعد الدخول الوحيد. يقرأ الـfixture، يضع كوكي الجهاز الموثوق للحساب المطلوب، ينفّذ خطوة كلمة المرور ويتحقق أنها `{ ok: false, mfa: 'code' }`، ثم ينهيها بـ`/api/auth/device`. كل الـspecs تستدعي `signIn(page, accountKey)` و`openShell()` و`signedInPage(browser, key)`؛ لم يبقَ أي `admin`/`admin` ولا أي `process.env.E2E_*_PASSWORD` في ملفات المرحلة.
- **`apps/web/e2e/fixtures/real-odoo-acceptance.py`**: صار يصدر `accounts` و`device` لكل حساب، ويُنشئ الحسابات التي تحتاجها الرحلة ولا يملكها الـseed: `finance_reader` (قراءة المشاريع والمال فقط)، `leave_config` (`hr.leave.config` فقط)، `pmo_manager`، `payroll_officer` (لتسجيل تعويضات المستقل وتسوية نهاية الخدمة التي تشترطها الأرشفة)، و`leave_staff` لرحلات الإجازات مع نوع إجازة مخصّص ورصيد 21 يومًا معتمدًا. لا يمسّ حسابًا لم يُطلب منه، ولا يعير حسابًا مشتركًا أدوارًا مؤقتة.
- **الـspecs الاثنا عشر**: انتقلت إلى المساعد المشترك، وحُذف كل تعبير يعتمد على واجهة أُزيلت (مصروف يدوي، `/reports`، `?tab=`، `reports-row`)، واستُبدل بما يثبت نفس الخاصية على العقد الحالي. `projects-phase2` صار 13 اختبارًا: حُذف اختبار «إنشاء مصروف يدوي مرتبط بميزانية» لأن القدرة أُزيلت من المنتج (`_liwan_check_manual_actual` يرفضها 422)، وحلّ محله اختبار يثبّت أن التكلفة الفعلية تأتي من مركز التكلفة وأن المصروف اليدوي مرفوض.
- **`deploy/ci/e2e-odoo.sh`**: `REAL_ODOO_SPECS` صار الملفات الأربعة عشر، و`EXCLUDED_REAL_ODOO_SPECS` فارغة مع تعليق يشرح أنها تبقى ليبقى للبوابة معنى. الحرس في `tools/test_ci_scope.py` (40 اختبارًا، كلها ناجحة) لا يزال يفشل إذا وُجد spec محروس بـ`E2E_REAL_ODOO` في أي من القائمتين.
- **`apps/web/e2e/support/mailOutbox.ts`**: صار يفكّ ترميز MIME (`base64`/`quoted-printable`) قبل البحث عن رابط الدعوة أو رمز الدخول، وينتظر البريد الذي يرسله خيط ما بعد الـcommit بدل قراءة الملف مرة واحدة. أُضيف `signInCode()`، وخُطّت خطوة الدخول الكاملة للحساب المدعو في `access-admin.spec.ts` (`invitedSignIn`: كلمة المرور ← رمز البريد ← تذكّر الجهاز).
- **`docs/testing.md`**: فقرة `e2e-odoo` تقول الآن أن الأربعة عشر كلها تعمل وأن المستثنى يبقى بالاسم مع السبب.

## عيبان أُصلحا في هذه الدورة

1. **الخروج كان يعيد إلى `/` لا إلى `/login`** — أُصلح. إعادة الإنتاج على المكدس الحقيقي: `POST /api/auth/logout` (204)، ثم هبوط على `/`، وهوية «E2E Admin» السابقة مرسومة في الغلاف، و**89 طلبًا** لـ`/api/v1/me` في 6 ثوانٍ كلها 401.

   **السبب الحقيقي (لا مجرد التخمين)**: `refreshNuxtData('me')` يستدعي `execute({ cause: 'refresh:hook' })`، وNuxt مع `experimental.granularCachedData` (المفعّل في هذا البناء، `.output/.../nuxt.config.mjs`: `export const n = true`) يقرأ داخل `asyncData.execute` فرع `getCachedData` لأي `cause` غير `initial`، فيعيد `nuxtApp.static.data.me`. ذلك المخزن ما زال يحمل هوية المستخدم الخارج، فتُحلّ `me` **نفسها مرة أخرى** ويبقى `error` فارغًا و`status = 'success'` — أي أن الجلسة تبدو قائمة. لذلك:
   - `useSignOut` ينادي `navigateTo('/login')` و`me` ما زال محمّلًا؛
   - حارس الزائر في `auth.global.ts` يقرأ `me.value` فيعيد `/login` إلى `/`؛
   - كل دورة تستدعي `refresh()` من جديد فتعيد الهوية من المخزن الثابت: حلقة `/api/v1/me` بلا نهاية (89 طلبًا).

   الإصلاح في `apps/web/app/composables/useSignOut.ts`: تسجيل `useNuxtData<Me | null>('me').data.value = null` **قبل** التنقل، بدل مجرد الاعتماد على إعادة الجلب. الجلسة انتهت على الخادم فعلًا (401 مؤكَّد)، فالقيمة `null` هي الجواب الصادق، والحارس لا يجد هوية يُبقيها. النتيجة المقيسة على نفس المكدس: الهبوط على `/login`، نموذج الدخول ظاهر، لا هوية قديمة، و**4 طلبات** فقط بدل 89، وتتوقف خلال 27 مللي ثانية. يثبّتها `apps/web/app/composables/__tests__/useSignOut.test.ts` (يفشل على الكود القديم) و`appearance-user.spec.ts` الذي يعود إلى `toHaveURL(/\/login/)` الحقيقي.
2. **`hr.leaveSettings.conflict` / `.saveError` / `.reload` / `.reloadError`** (`apps/web/i18n/locales/{ar,en}/hr.json`) — حُذفت. `git grep` لا يجد أي مستخدم: البطاقة تعرض `app.settingsConflict` و`app.reloadCurrent` من `packages/ui` (`SettingsCard.vue`)، والرسالة تأتي من `useSettingsForm` عبر `saveErrorMessage`.

## ما بقي غير مثبت

- المرحلة لم تُشغَّل عبر GitHub Actions؛ هذا تشغيل محلي على جهاز مطوّر، وليس دليل نشر.
- الزمن المحلي (دقيقتان للـspecs، وأكثر مع تركيب الوحدات والبناء) لا يمثل زمن CI على `ubuntu-24.04`.
- بنك البريد غير مهيّأ في `deploy/ci/e2e-odoo.sh` (لا يضبط `E2E_MAIL_OUTBOX`)، فالدعوات تُسجَّل `delivery: failed` و`state: pending`؛ الاختبارات تقرأ الحالة من الـAPI وتؤكد ما يعرضه السجل، ولا تدّعي أن رسالة وصلت.
- الخطوات التي تحتاج جلسة حساب مدعو تبقى مشروطة بـ`E2E_MAIL_OUTBOX`: أربعة اختبارات في `access-admin` (تتخطّى) وخطوات ما بعد القبول في `hr-people-access`. أُثبت محليًا أن الأربعة تنجح عند توفير البنك، لكن CI لا يوفّره بعد؛ تشغيلها هناك يحتاج ضبط بنك بريد في المرحلة، وهو تغيير خارج نطاق هذه المهمة.

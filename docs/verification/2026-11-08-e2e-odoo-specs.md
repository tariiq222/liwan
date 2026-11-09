# تشغيل مرحلة `e2e-odoo` على Odoo حقيقي بعد ترحيل كل الـspecs

التاريخ: **2026-11-08/09**. النتيجة: **أربعة عشر ملفًا من أربعة عشر تنجح (83 اختبارًا من 83)، ولم يبقَ أي ملف مستثنى**. القضية: #576.

## المصدر والبيئة

- المصدر: فرع `codex/tools-e2e-odoo-specs` من `main` عند `3a9a79ddd70e4e9bbfcd66528bc7481400e90154`، مع تعديلات الفرع غير الملتزمة وقت التشغيل (الـspecs والمشتركات والـfixture و`deploy/ci/e2e-odoo.sh` و`docs/testing.md`). لم يُغيَّر أي كود منتج.
- الجهاز: macOS محلي، PostgreSQL محلي، Odoo من `/Users/tariq/code/odoo` بمنفذ **8172**، وبناء إنتاج لـ Nuxt على المنفذ **44300**.
- القاعدة: `liwan_scratch_e2e` فقط. أنشأها السكربت وحذفها عند الانتهاء. لم يُلمس `liwan_dev` ولا `odoo19`.
- الأمر المُلزِم (السكربت نفسه، كما في CI):
  `PGPASSWORD= ODOO_ROOT=/Users/tariq/code/odoo ODOO_PYTHON=/Users/tariq/code/odoo/.venv/bin/python ODOO_PORT=8172 PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tariq bash deploy/ci/e2e-odoo.sh`
  عبر `/Users/tariq/.local/bin/agent-local-load heavy`. (الغلاف المحلي في الفقرات أدناه استُخدم أثناء الترحيل لإعادة تشغيل ملف واحد بلا إعادة بناء المكدس؛ النتيجة المعتمدة أدناه من السكربت الحقيقي.)
- لا نداء لنموذج ولا مفتاح API. عامل Playwright واحد.

## النتيجة النهائية

تشغيل `deploy/ci/e2e-odoo.sh` الحقيقي على قاعدة مؤقتة جديدة: **83 اختبارًا، 83 نجحت، 0 فشل، 0 تخطٍّ، 0 لم تُنفَّذ، في دقيقتين و12 ثانية للـspecs**، ثم حرّر السكربت المنفذين وحذف القاعدة (تحقّق بعد التشغيل: لا مستمع على 44300 أو 8172، ولا قاعدة `liwan_scratch_e2e`، ولا نسخة من `fixtures.json`).

قبل ذلك جرى نفس التجميع عبر غلاف محلي يُبقي الخادمين: **83 من 83 في دقيقتين وست ثوانٍ**، ثم **مرّتان متتاليتان على قاعدة جديدة كل مرة: 83 من 83 في كل مرة**، وهو ما استُخدم لقياس كل ملف وهو منفرد ويثبت أن الترتيب بين الملفات لا يهم.

تحذير تشغيلي لاحظته في الغلاف المحلي: إذا بقي خادم Nuxt يتيم على 44300 من دورة سابقة، يموت البناء الجديد بـ`EADDRINUSE` بينما يجيب الخادم القديم عن قاعدة أُعيد إنشاؤها، فتفشل معظم الاختبارات لأسباب لا علاقة لها بالكود. `deploy/ci/e2e-odoo.sh` يرفض البدء إذا كان المنفذ مشغولًا، فالمشكلة لا تصيبه.

| الملف | الاختبارات | لماذا كان يفشل قبل الترحيل |
| --- | --- | --- |
| `real-odoo-acceptance.spec.ts` | 31 | كان ينجح؛ أُعيد على المشترك الجديد |
| `real-odoo-services.spec.ts` | 4 | كان ينجح؛ أُعيد على المشترك الجديد |
| `access-admin.spec.ts` | 9 | `admin`/`admin` بخطوة واحدة، وموضعان تغيّرا في المنتج (قائمة إجراءات الدور، حالة الدعوة) |
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

## ما تغيّر

- **`apps/web/e2e/support/realOdooSession.ts` (جديد)**: مساعد الدخول الوحيد. يقرأ الـfixture، يضع كوكي الجهاز الموثوق للحساب المطلوب، ينفّذ خطوة كلمة المرور ويتحقق أنها `{ ok: false, mfa: 'code' }`، ثم ينهيها بـ`/api/auth/device`. كل الـspecs تستدعي `signIn(page, accountKey)` و`openShell()` و`signedInPage(browser, key)`؛ لم يبقَ أي `admin`/`admin` ولا أي `process.env.E2E_*_PASSWORD` في ملفات المرحلة.
- **`apps/web/e2e/fixtures/real-odoo-acceptance.py`**: صار يصدر `accounts` و`device` لكل حساب، ويُنشئ الحسابات التي تحتاجها الرحلة ولا يملكها الـseed: `finance_reader` (قراءة المشاريع والمال فقط)، `leave_config` (`hr.leave.config` فقط)، `pmo_manager`، `payroll_officer` (لتسجيل تعويضات المستقل وتسوية نهاية الخدمة التي تشترطها الأرشفة)، و`leave_staff` لرحلات الإجازات مع نوع إجازة مخصّص ورصيد 21 يومًا معتمدًا. لا يمسّ حسابًا لم يُطلب منه، ولا يعير حسابًا مشتركًا أدوارًا مؤقتة.
- **الـspecs الاثنا عشر**: انتقلت إلى المساعد المشترك، وحُذف كل تعبير يعتمد على واجهة أُزيلت (مصروف يدوي، `/reports`، `?tab=`، `reports-row`)، واستُبدل بما يثبت نفس الخاصية على العقد الحالي. `projects-phase2` صار 13 اختبارًا: حُذف اختبار «إنشاء مصروف يدوي مرتبط بميزانية» لأن القدرة أُزيلت من المنتج (`_liwan_check_manual_actual` يرفضها 422)، وحلّ محله اختبار يثبّت أن التكلفة الفعلية تأتي من مركز التكلفة وأن المصروف اليدوي مرفوض.
- **`deploy/ci/e2e-odoo.sh`**: `REAL_ODOO_SPECS` صار الملفات الأربعة عشر، و`EXCLUDED_REAL_ODOO_SPECS` فارغة مع تعليق يشرح أنها تبقى ليبقى للبوابة معنى. الحرس في `tools/test_ci_scope.py` (40 اختبارًا، كلها ناجحة) لا يزال يفشل إذا وُجد spec محروس بـ`E2E_REAL_ODOO` في أي من القائمتين.
- **`docs/testing.md`**: فقرة `e2e-odoo` تقول الآن أن الأربعة عشر كلها تعمل وأن المستثنى يبقى بالاسم مع السبب.

## عيوب منتج اكتُشفت أثناء الترحيل ولم تُصلَح (خارج ملكية هذه المهمة)

1. **الخروج يعيد إلى `/` لا إلى `/login`**: بعد `POST /api/auth/logout` (204) و`GET /api/v1/me` (401)، `useSignOut` (`apps/web/app/composables/useSignOut.ts:26`) ينادي `navigateTo('/login')`، لكن حارس الزائر في `apps/web/app/middleware/auth.global.ts:21` يعيد `/login` إلى `/` ما دام `me.value` غير فارغ، فتبقى الهوية السابقة مرسومة ويُعاد طلب `/api/v1/me` بعشرات المرات (71 طلبًا في ~6 ثوانٍ، كلها 401). `appearance-user.spec.ts` يثبت اليوم أن الجلسة انتهت فعلًا (`/api/v1/me` = 401) ويسجّل مسار الهبوط كتعليق وتشخيص، بدل أن يعتمد على إعادة توجيه معطوبة.
2. **`hr.leaveSettings.conflict` / `.reload` / `.reloadError`** (`apps/web/i18n/locales/ar/hr.json:457-459`) صارت مفاتيح ميتة: البطاقة تعرض `app.settingsConflict` و`app.reloadCurrent` من طبقة الواجهة المشتركة.

## ما بقي غير مثبت

- المرحلة لم تُشغَّل عبر GitHub Actions؛ هذا تشغيل محلي على جهاز مطوّر، وليس دليل نشر.
- الزمن المحلي (دقيقتان للـspecs، وأكثر مع تركيب الوحدات والبناء) لا يمثل زمن CI على `ubuntu-24.04`.
- بنك البريد غير مهيّأ على المكدس المؤقت، فالدعوات تُسجَّل `delivery: failed` و`state: pending`؛ الاختبارات تقرأ الحالة من الـAPI وتؤكد ما يعرضه السجل، ولا تدّعي أن رسالة وصلت. خطوات ما بعد القبول في `access-admin` و`hr-people-access` تبقى مشروطة بـ`E2E_MAIL_OUTBOX` كما كانت.

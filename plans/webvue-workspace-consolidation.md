# خطة ترتيب مساحة عمل ويب فيو

**الحالة:** مسودة مُصلحة، بانتظار إعادة المراجعة المستقلة واعتماد المستخدم؛ لا ادعاء `PASS`.  
**النطاق الآن:** وثائق تخطيط فقط؛ لا مصدر أو مراجع Git أو أوامر أو اختبارات أو runtime أو شبكة.  
**النتيجة المستهدفة:** حفظ العمل، إزالة التكرار، مصالحة الاختلافات، ثم حزم مستقلة قابلة للتحقق والدمج المصرّح؛ ليست إكمال SaaS أو إطلاقه.

## ملخص عملي في ست مراحل

1. اعتماد النطاق وإعادة الجرد مع مالكي الملفات والموارد (P0–P1).
2. حفظ لقطات قابلة للاسترجاع، مع فصل المصدر عن اتساق قواعد البيانات (P2).
3. تجميد خريطة دقيقة لكل ملف/hunk ومالكه وقراره واعتماده (P3).
4. فتح المسارات غير المتداخلة: E2E، PMO، UI-only، ومصالحة العقود المشتركة (P4–P7).
5. استخراج الموجود التجاري وfeed/package وفق الخطة القائمة، والتحقق لكل حزمة فور جاهزيتها (P8–P9).
6. محاسبة كل العمل المحفوظ وقرارات التكامل/التنظيف المنفصلة؛ لا يلزم اكتمال كل ميزات المنتج لإغلاق التنظيم (P10).

## 1. حقائق البداية وحدودها

هذه نتائج جرد سابق للقراءة فقط، وليست حالة تنفيذ جديدة أو إعادة اختبارات؛ تُحدّث في P1.

| السطح | الحقيقة المثبتة في اللقطة |
|---|---|
| `main` | `5dc1daef`، أحدثه تجهيز واستعادة Odoo الحقيقيين؛ 16 dirty paths لإضافة TesterArmy E2E: 3 tracked +13 untracked. |
| `origin/main` | مرجع تتبّع محلي `4eab6fd7`؛ المقارنة `6 0` دون fetch؛ لا تثبت حالة الخادم الحالية. |
| `codex/saas-commercial` | 340 dirty paths: 78 tracked +262 untracked؛ المصدر والاختبارات والتوثيق التجاري. |
| `codex/ui-live-review` | 123 dirty paths: 84 tracked +39 untracked؛ في مجلد `saas-lifecycle-integration`، ويخلط UI repairs مع feed/package. |
| تقاطع commercial/UI | 68 paths: 47 متطابقة بالبايت و21 مختلفة بالمحتوى؛ الاختلاف ليس حكمًا تلقائيًا بأن أحد الطرفين أصح. |
| اتحادهما | **395 paths =272 commercial-only +55 UI-only +68 shared**؛ لا يُختزل حساب الاكتمال في الـ21. |
| `codex/pmo-docker-acceptance` | 7 dirty paths؛ تنقل واختبارات PMO وتقرير، وليس اسم Docker دليلًا على نطاق المحتوى. |
| `codex/saas-first-tenant-ui` | 8 status paths مقابل HEAD قديم؛ 7 مطابقة لـmain، بما فيها الملفان untracked؛ الثامن `tenants/new.vue` يختلف بمسافة ASCII نهائية فقط. لا تغيير وظيفي فريد. |
| `codex/saas-real-lifecycle` | نظيف، والتنفيذ السابق ضمن main بحدود القبول المحلي. |
| `codex/integrate-saas-lifecycle` | بلا worktree مسجل أو branch-only commits في الجرد. |
| `85a697f4` | WIP PMO في تاريخ main، عنوانه غير متحقق/غير مختبر؛ وجوده لا يثبت قبولًا. |

مساواة فرع لـmain لا تعني نظافة ملفات العمل. توثيق `docs/WORKSPACE.md` عن تنظيف سابق تاريخي؛ الجرد الحي أقوى. تقرير UI يسجل زيارة 52/102 route templates وقبول رحلات محددة، لا قبول كل الحالات. سجل التجاري يسجل E04 **FAIL** وE05–E16 **BLOCKED**؛ السبب غير محسوم في التخطيط، والدفع Simulator لا مزوّدًا حقيقيًا.

## 2. الأدوار والتفويض والحماية

- **المنسق الأعلى read-only:** يحدد العقود والملكية والاعتمادات، يفوّض، ويستقبل الأدلة؛ لا يكتب المصدر أو يتولى التنفيذ/المراجعة بنفسه.
- يعيّن **integration executor واحدًا من tier strong** لكل الملفات المشتركة المحجوزة، و**verifier مستقلًا strong بنموذج مختلف** عن المنفذ وفق الراوتر؛ لا ادعاء مراجعة مستقلة مختلفة النموذج إن تعذر ذلك.
- العمال strong يكتبون فقط manifests الحصرية المجمّدة. لا يسمح عنوان الحزمة أو glob بكتابة ملفات أخرى. ملكية تنفيذ Git/runtime واحدة ومسمّاة، لكنها لا تمنح أي إجراء دون تفويضه المنفصل.
- جلسة التخطيط لا تشغّل أي أوامر. بعد تفويض نطاق التنفيذ، static/unit/build المحلي المعتاد داخله لا يحتاج موافقة تحديث منفصلة، وفق `docs/UPDATE_POLICY.md:5`؛ لا يبيح ذلك Odoo/live DB أو تشغيل/تغيير خدمات أو بيانات أو Git.
- موافقات commit، merge، fetch، push، deploy، cleanup منفصلة. لا استنتاج من اعتماد الخطة أو نجاح فحص محلي. لا reset/stash/drop/discard ضمنيًا، ولا `ours/theirs` أو استبدال ملف كامل من نسخة قديمة.
- المهام في worktrees مؤقتة `codex/<task>` من main المثبت، لا checkouts دائمة للأعمدة؛ `node_modules` و`.nuxt` مستقلان بلا symlinks، وقواعد ومنافذ وlogs/volumes منفصلة.
- مصدر Odoo read-only. لا اختبارات على `odoo19`. الأرشيفات والوسوم ومواد الاسترداد القائمة تُحفظ ولا يعاد فتحها بدل اللقطات الحية.

## 3. المراحل — كلها تنفيذ مستقبلي pending

### P0 — اعتماد نطاق التنظيم

**المالك/الاعتماد:** المستخدم والمنسق read-only؛ لا سابق.  
**الهدف/النطاق:** تحديد ما أُذن به للجرد والحفظ، والأدوار، والقرارات المؤجلة؛ لا بدء goals أو tasks تنفيذية في جلسة التخطيط.  
**القبول:** جدول الإجراءات المسموحة وحدودها؛ لا موافقة ضمنية على تغيير سلوك أو حذف.  
**الرجوع:** تعديل الخطة فقط دون لمس العمل.

### P1 — جرد حي وخمود آمن

**المالك/الاعتماد:** منفذ جرد read-only يعيّنه المنسق؛ P0.  
**النطاق:** checkouts والفروع، tracked/staged/untracked/ignored، WIP المدمج، مالكو العمليات والكتابة، المنافذ وDocker/Odoo/PG والـmounts والأدلة الخاصة.  
**المخرج:** baseline SHA، hashes، نوع الملف/الرابط والصلاحيات، صاحب كل مورد، collision matrix، وحالة live/quiesced.  
**التحقق المستقبلي:** status/worktree/ref reads وفحص الموارد دون fetch/prune أو إيقاف.  
**القبول/الرجوع:** لا كاتب متعارض أو موافقة مالكه على نافذة آمنة؛ إن تعذر الخمود تُحجب الحزمة/cleanup، لا forced kill، وتبقى الأصول.

### P2 — حفظ قابل للاسترجاع

**المالك/الاعتماد:** حافظ scoped مستقل؛ P1 وإذن الكتابة إلى موضع حفظ خاص.  
**النطاق:** snapshot منفصلة لكل worktree خارج المستودع في موضع خاص يختاره المستخدم أو يعتمد اقتراحه لاحقًا، تشمل المصدر dirty/new وignored evidence والروابط والصلاحيات؛ manifest كامل خاص، ونسخة source-manifest منقحة مستقبلية بلا أسرار، لا ملف يُنشأ في هذه الجلسة.  
**حماية البيانات:** أرشفة المصدر ليست backup متسقًا لـPG/volumes حية. تعتمد طريقة اتساق/نسخ ونافذة تشغيل مصرح بها أو تسجل provenance و`runtime recovery unverified`؛ لا copy حي لـPG data directory بوصفه استردادًا مضمونًا.  
**القبول:** hashes وrestore rehearsal غير متلف إلى مسار مؤقت للمصدر والروابط والصلاحيات والأدلة؛ شرط اتساق مستقل لأي ادعاء تعافي بيانات.  
**الرجوع:** توقف عند نقص/تغير hash؛ احتفظ بالمصدر والأرشيفات القائمة دون حذف أو commit تلقائي.

### P3 — تجميد manifests وبوابة dispatch

**المالك/الاعتماد:** المنسق read-only يكلّف مصنفًا scoped، ويخصص integration executor/verifier؛ P2.  
**النطاق:** جميع الـ395 paths، إضافة PMO السبعة وmain E2E وWIP `85a697f4` وignored data/evidence والأرشيفات. لا تُحسب 47 identical مرتين، ولا يُسقط commercial-only أو UI-only.

**لكل path/hunk سجل إلزامي:** المصدر/موضع snapshot، hash، baseline main المثبت، الحزمة، كاتب واحد، prerequisites، tests والأوامر وcwd والموارد، acceptance، قرار السلوك، verifier، وموضع دليل الحفظ. القرار: accepted/integrated أو preserved-pending مع blocker أو user-approved-deferred مع موافقة محددة؛ deferred behavior يبقى محفوظًا ولا يسقط بصمت.

**بوابة dispatch:** قائمة paths حرفية وhunks لا broad globs؛ freeze لكل dependencies/generated files/schema/import/barrels وDB/ports/conf/logs؛ named accepted prerequisite commits أو frozen candidate SHA. ملكية shared المذكورة أدناه واحدة قبل فتح التوازي. مجهول النطاق/المورد/العقد يمنع إرسال تلك الحزمة، لا يوسّع نطاقها.

**القبول/الرجوع:** لكل original change قرار حفظ ومالك؛ source provenance والبصمات ثابتة. تعارض حقيقي في سلوك معتمد يُرفع للمستخدم، لا يُحسم تحت عبارة «ترتيب العمل».

### P4 — E2E إضافي مستقل

**المالك/الاعتماد:** worker strong على القائمة الحصرية المجمدة؛ P3 فقط.  
**نطاق مرشح، لا dispatch قبل تجميده:** `package.json`, `package-lock.json`, `docs/e2e.md`, `e2e.config.ts`, `e2e/models.ts`, ملفات `e2e/tests/` و`.agents/skills/e2e/` المحددة. **`.gitignore` خارج ملكيته**؛ يرفع طلب hunk إلى integration executor.  
**القبول/التحقق:** إضافي لا يضعف Playwright/Vitest القائمين؛ checks محلية ضمن التفويض، وسلامة dependency/lock/build. `npm run e2e:smoke` لاحقًا فقط بعد موافقة التكلفة/إرسال بيانات إلى provider وبيئة scratch مملوكة معزولة؛ لا existing runtime أو autostart على main:3000.  
**الرجوع:** رفض candidate مع حفظ لقطة؛ لا install/build في main أو state مشترك أو تغيير credentials/runtime تلقائي.

### P5 — PMO residual ومراجعة WIP

**المالك/الاعتماد:** worker strong؛ P3 فقط.  
**المسارات المرشحة الحصرية:** `apps/web/app/pages/project-templates/index.vue`, `apps/web/e2e/detail.spec.ts`, `apps/web/e2e/projects-phase1.spec.ts`, `apps/web/e2e/task-attachments.spec.ts`, `apps/web/e2e/task-lifecycle.spec.ts`, `docs/verification/2026-10-01-pmo-docker-acceptance.md`.  
**استثناء:** `apps/web/app/pages/__tests__/recordBackTargets.test.ts` يراجَع ويُطلب hunk له، ولا يكتبه P5 أو P6؛ دمجه بواسطة integration executor بعد نتيجتيهما. WIP `85a697f4` مراجعة behavior/source ضمن manifest منفصل، لا إذن كتابة واسع لـOdoo.  
**القبول/التحقق:** فصل اختبار/إصلاح/دليل؛ قبول scoped للمتأثر وتوابعه، مع عدم إضعاف assertions القديمة لتمرير WIP.  
**الرجوع:** preserved-pending عند غياب الدليل؛ عيب جديد ينشئ حزمة bounded مستقلة بعد قرار، لا توسيع صامت.

### P6 — UI-only بلا shared contracts

**المالك/الاعتماد:** worker strong؛ P3 فقط.  
**النطاق:** paths/hunks الدقيقة لإصلاح back/origin/filter/hash والنماذج وHR/documents وmeetings/employee/print، بعد إخراج **كل الـ21** و`recordBackTargets.test.ts` و`useApi.ts` وcommon locales وgenerated catalog، وكل vendor feed/package/selection pages المتصلة بالعقد إلى integration/P8. لا control-plane أو commercial contracts أو Odoo أو commercial tools.

**القبول/التحقق:** direct/refresh/back/query/hash وpermission/draft/RTL/hydration باقية؛ tests للمتأثر وتوابعه، وUI policy/typecheck. الموجود يستخرج ويُراجع، لا تفرض RED مصطنعًا لإعادة قبول إصلاح قائم؛ عيب مؤكد جديد يتبع regression RED→GREEN ومراجعة مستقلة.  
**الرجوع:** احتفاظ بالتغيير pending إذا تعذر قبول حالة؛ coverage 52/102 ليست اكتمالًا شاملًا، ولا يُؤجل سلوك معتمد دون قرار المستخدم.

### P7 — العقود والمشتركات: مسار تكامل واحد

**المالك/الاعتماد:** integration executor strong واحد + verifier strong مختلف النموذج؛ **P3 فقط، لا ينتظر P4/P5/P6**. يصالح الملفات المحجوزة التي لا يكتبها هؤلاء؛ feed/package downstream في P8.  
**النطاق:** الـ21 أدناه، والمشتركات المجمدة: `apps/web/app/composables/useApi.ts`, `apps/web/i18n/locales/ar/common.json`, `apps/web/i18n/locales/en/common.json`، generated catalog ومراجعه، schema/barrels، vendor/feed/package shared paths. `.gitignore` يملكه المنفذ نفسه: يجمع hunks `.e2e` والأدلة التجارية الخاصة دون كشفها؛ يستثنيه E2E/commercial workers. تطبيق `recordBackTargets.test.ts` مهمة تكامل لاحقة لنتيجتي P5/P6 فقط، ولا يحجب بدء P7.

**قائمة الـ21 الدقيقة:**

1. `apps/control-plane/src/__tests__/operation-feed.test.ts`
2. `apps/control-plane/src/__tests__/packages.test.ts`
3. `apps/control-plane/src/db.ts`
4. `apps/control-plane/src/http.ts`
5. `apps/control-plane/src/packages.ts`
6. `apps/control-plane/src/shared/job-store.ts`
7. `apps/control-plane/src/shared/job-worker.ts`
8. `apps/control-plane/src/shared/odoo-adapter.ts`
9. `apps/control-plane/src/shared/onboarding.ts`
10. `apps/web/app/pages/vendor/overview.vue`
11. `apps/web/i18n/locales/ar/vendor.json`
12. `apps/web/i18n/locales/en/vendor.json`
13. `docs/design-system/catalog.json`
14. `docs/design-system/components.md`
15. `docs/superpowers/specs/2026-10-02-saas-commercial-product.md`
16. `packages/commercial-contracts/src/index.ts`
17. `packages/commercial-contracts/src/shared/provisioning.ts`
18. `tools/webvue_cli/managed_policy.py`
19. `tools/shared_saas_lifecycle/odoo_effect.py`
20. `tools/shared_saas_lifecycle/test_odoo_effect.py`
21. `tools/ui_policy.py`

**الطريقة/القبول:** three-way على main المثبت ولقطتي commercial/UI؛ لا اختيار الأكبر أو blanket conflict resolution. حفظ authority/fencing/isolation وreal lifecycle وcompatible UI feed/package behavior. 47 identical تستخدم بعد hashes مرة واحدة. generated catalog يعاد توليده بأدوات المشروع بواسطة المنفذ الواحد، لا تعديل يدوي بدل مولّده؛ migrations المطبقة immutable مع version/order/dependency وفق سياسة المشروع وخطط A/B القائمة. عقد غير محسوم يبقى محفوظًا ويمنع downstream المتأثر فقط. مراجعة وفحوص contracts/schema/worker وتوابعها لكل subpackage.  
**الرجوع:** رفض candidate أو حفظ الاختلاف pending؛ لا إعادة كتابة approved behavior أو إسقاطه لتسهيل الدمج.

### P8 — استخراج الشرائح التجارية القائمة وfeed/package

**المالك/الاعتماد:** workers strong على manifests منفصلة؛ P7 والعقود المقبولة الخاصة بالشريحة، وفق A/B/C الموجودة، لا DAG تجاري بديل.  
**النطاق:** استخراج ومراجعة الموجود في A (التطبيقات/الحزم/الباقات/التسعير)، B (الاشتراك/الفوترة/التفعيل/الدعوات/الفروع/الواجهات)، C (migration/acceptance evidence)، وUI feed/package downstream. يُحجز أي shared file للمنفذ الواحد ويُمنع overlap مع P6؛ لا broad `apps/**` dispatch. **إكمال C1/C2 ليس شرط إغلاق التنظيم، وC3 خارج النطاق.**

**E04:** سجل FAIL والسبب مجهول؛ يبدأ source-only investigate، ثم reproduction مصرح ومعزول عند الحاجة، ثم bug-fix فقط لعيب source-confirmed مع regression RED وGREEN وindependent qa. الرحلة المحجوبة تبقى gap؛ لا simulator كبديل provider ولا readiness relabel.  
**القبول/الرجوع:** كل شريحة accepted أو preserved-pending أو user-approved-deferred مع snapshot وسبب ومالك؛ لا حذف سلوك مؤجل أو إكمال ميزات جديدة ضمن التنظيم.

### P9 — تحقق مستقل لكل حزمة وتابعها

**المالك/الاعتماد:** منفذ scoped ثم verifier strong مختلف النموذج؛ **يرتبط بكل حزمة عند جاهزيتها، لا ينتظر اكتمال P4–P8 كلها**.  
**baseline:** كل مهمة pin لأحدث main وقت إعدادها + أسماء accepted prerequisite commits أو frozen candidate SHA؛ لا تعتمد diff وHEAD القديمين للوورك تري كمصدر حقيقة. integration candidate ضد latest main baseline؛ التقارير التاريخية لا تصبح fresh evidence.  
**القبول:** checks للمتأثر **وتوابعه**، diff/حذف/سلوك/permissions/contracts، counts/exit codes، baseline failure منفصل ومثبت إن أمكن؛ unknown baseline يذكر صراحة، ولا weakening للـassertions لتمريره. new defect→حزمة bounded مستقلة؛ لا deliberate failed gate.

**أوامر مستقبلية معروفة؛ كلها من جذر selected worktree المستقل ما لم يذكر cwd آخر:**

- `npm -w apps/web run test -- app/pages/__tests__/recordBackTargets.test.ts`؛ الملف المحجوز يتبع دمج P5/P6 بواسطة المنفذ الواحد.
- `npm -w apps/web run test`؛ `npm -w apps/web run lint`؛ `python3 -B tools/ui_policy.py`.
- `npm -w packages/contracts run test`؛ `npm -w packages/contracts run build`؛ `npm -w packages/commercial-contracts run test`؛ `npm -w packages/commercial-contracts run build`.
- `CONTROL_TEST_DATABASE_URL=<validated-isolated-scratch-url> npm -w apps/control-plane test` ثم `npm -w apps/control-plane run build`؛ إذن live DB، loopback وقاعدة فريدة تطابق `^webvue_control_scratch_[a-z0-9]+$`، suite serial بلا lane أخرى على القاعدة، وnonzero affected live-SQL tests؛ skip عند غياب URL ليس PASS. لا أسرار في الأدلة أو قيمة URL ثابتة مختلقة.
- PMO Playwright منفصل عن Vitest الذي يستثني e2e: cwd `apps/web`، بعد تجميد config/fixtures وruntime مملوك مصرح، `E2E_BASE_URL=<owned-isolated-url> npm run test:e2e -- e2e/detail.spec.ts e2e/projects-phase1.spec.ts e2e/task-attachments.spec.ts e2e/task-lifecycle.spec.ts`؛ credentials خاصة، worker واحد وفق config الحالي، لا main:3000 أو `odoo19`، وتراجع config في selected worktree قبل التشغيل.
- `python3 -B -m unittest tools.shared_saas_lifecycle.test_odoo_effect`؛ بقية focused tests/cwd/resources تتجمد في P3 قبل dispatch، لا وحدة اختبار مختلقة.
- `npm test` للنتيجة المتكاملة، ثم اختبارات Odoo **فقط إن أُذن بها** وفق CLAUDE وskill `odoo-workflow`: cwd `/Users/tariq/code/odoo`، Python الموثق، addons لمسار selected worktree الصريح، scratch-only config/data/log، DB/ports مستقلة، tags/modules المعنية وnonzero test count؛ لا live config أو `odoo19`.
- isolated browser/restore/upgrade checks عندما تقع ضمن الحزمة المأذونة بموارد P3؛ لا literal CI cleanup/dropdb ولا autostart runtime قائم. build/unit محلي لا يبيح خدمات/بيانات أو provider network.

**الرجوع:** حافظ على اللقطة والأدلة، لا وصف PASS لمجرد وجود source/تقرير أو exit0 بلا tests فعلية.

### P10 — محاسبة الإغلاق وقرارات الترقية

**المالك/الاعتماد:** المنسق read-only يجمع قرارات كل الحزم بعد P9 الخاص بها؛ إجراءات Git/runtime فقط بمنفذ مسمى وتفويض مستقل.  
**إغلاق التنظيم:** كل original path/hunk ضمن الـ395 وبقية PMO/E2E/WIP/ignored data محسوب accepted/integrated أو preserved-pending أو user-approved-deferred؛ source recovery مثبت وحدود data recovery صريحة. لا يشترط كل features green، ولا يُسمى هذا إطلاقًا.

**قبل merge مأذون:** قراءة سياسة canonical AGENTS وآخر committed main؛ تسجيل baseline والطرف الداخل وفحص dirty كلا الطرفين؛ candidate معزول مبني على latest main، diff ومراجعة وفحوص affected+dependents. قبل FF إعادة فحص tip: عند drift يعاد البناء والمراجعة والتحقق، لا promotion قديم.

**dirty-main intersection:** قارِن paths candidate مع dirty main، خصوصًا E2E و`.gitignore`/package/lock. احفظها، وأدرج hunk فقط بإذن commit يشمله صراحة، وإلا احجب promotion المتقاطع. لا implicit stash/reset/drop ولا اعتبار dirty files جزءًا من candidate مختبر تلقائيًا.

**بوابات منفصلة:** commit، merge/FF، fetch/مقارنة origin قبل integration حسب السياسة، push، deploy/DNS، cleanup. preservation لا يجيز حذفًا؛ تنظيف worktree/branch يحتاج content preserved وquiescence/process/data check وموافقة محددة. عند مورد حي غير مخمّد يحجب cleanup، لا forced kill.  
**الرجوع:** candidate مرفوض محفوظ؛ قبل integration لا يتغير main. أي rollback بعد promotion قرار مستقل، لا rewrite published history.

## 4. DAG والتوازي وحدود الملكية

```text
P0 → P1 → P2 → P3 (scope/resource freeze)
                 ├─ P4 E2E ──────────────────→ P9(P4)
                 ├─ P5 PMO ──────────────────→ P9(P5)
                 ├─ P6 UI-only ──────────────→ P9(P6)
                 └─ P7 shared contracts ─────→ P9(P7) → P8 slices → P9(each slice)
P5 + P6 results → single integration executor: recordBackTargets → own P9
All decided packages + preserved accounting → P10
```

P4/P5/P6/P7 تفتح معًا بعد P3 **فقط** بانعدام shared writes وبموارد مستقلة. إذا كشفت manifests اعتمادًا جديدًا، يحجب الجزء المتأثر ويعاد تجميده، لا تفرض barrier شاملًا. منفذ shared واحد يسلسل hunks `.gitignore` وuseApi/common/catalog والـ21؛ لا يتسابق معه P8. control-plane live suites serial بقاعدة خاصة، وdependencies/generated state لا تشارك بين worktrees.

## 5. بروتوكول تعديل الخطة وcold-start

- اقرأ canonical `AGENTS.md`, `CLAUDE.md`, `docs/WORKSPACE.md`, `docs/parallel-work.md`, `docs/UPDATE_POLICY.md`، والخطة وملفات `.planning/webvue-workspace-consolidation/`؛ الأقدم سياق لا snapshot حي.
- tip جديد أو collision أو contract/resource change→توقف الحزمة المتأثرة، حفظ evidence، إعادة P1/P3 اللازمة، re-freeze manifest/hash/owner/prerequisite/candidate ثم reverify؛ لا توسّع ملكية تلقائيًا.
- تعارض genuine مع approved behavior أو اقتراح إسقاط deferred behavior→قرار المستخدم المحدد أولًا؛ compatible changes تحفظ دون طلب إلغاء القرارات السابقة.
- عند رفض hash/quiescence/review/check: احتفظ بالأصول وموضع snapshot، وسجل blocker. rollback source إلى temporary worktree فقط؛ runtime يحتاج backup متسقًا وإذنًا، لا copy live volume.
- التقرير النهائي يفصل inspected/changed locally/verified/committed/merged/pushed/deployed/cleaned؛ كل تصريح يحتاج دليلًا حديثًا في طبقته. لا timelines مختلقة أو درجة جاهزية.

**القرار المطلوب:** اعتماد الخطة أو تعديلها، ثم تحديد إذن P1/P2 وحدوده؛ الاعتماد وحده لا يجيز تنفيذ P4–P10 أو Git/runtime/cleanup.

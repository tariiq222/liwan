# تحديث ويب فيو والإضافات مع استمرار الخدمة — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after owner approval. Steps use checkbox (`- [ ]`) syntax for tracking. Any delegation requires explicit file ownership and the project routing policy.

**Goal:** استمرار القراءة والحفظ في تحديثات الكود المتوافقة، وعزل صيانة ترقيات Odoo في عميل واحد دون قطع بقية العملاء.

**Architecture:** مجموعات إصدار قابلة للتحويل لكل عميل، بسلطة تشغيل واحدة وفصل مراجعة الإصدار عن هوية العميل. محرك نشر operator محلي، وHTTP/cron/jobs معزولة بأجيال، ومساران منفصلان للكود المتوافق وترقية القاعدة. لا تعديل في مصدر Odoo أو نسخ قديمة داخل كود المنتج.

**Tech Stack:** Odoo 19، Nuxt 4/Nitro، Docker Compose، Caddy، PostgreSQL 16، Python/SQLite، Node.js.

**Spec:** [التصميم والأدلة وسياسة التوقف](../specs/2026-10-16-webvue-continuous-updates-design.md)، مع عقد `webvue-shared-saas-and-sovereign-deployment` وسياسة `docs/migrations.md` وAGENTS.md.

**Status:** اعتمد المالك التنفيذ والاختبار المحليين في 2026-10-16، مع منع النشر والدمج حتى مراجعة النتائج. نُفّذت الحزمة في `codex/deploy-continuous-updates` من الأساس `dca71b8b45a15ee138bf1ae41d345fa099c105e0`. نتائج القبول وحدودها في [تقرير التنفيذ](../../verification/2026-10-16-continuous-updates.html). مصدر المراجعة الأصلي `67902a053821ea4895047c804015addcc2e4f15a` تاريخي؛ لا يصف main الحالي بعد إعادة تسمية المشروع إلى WebVue.

## نتيجة التنفيذ المحلي

- [x] عقد الإصدار والتصنيف، مجموعات التشغيل، تثبيت الطلبات والأصول، محرك دائم، fencing والنسخ والترقية والاستعادة، وجدولة لكل عميل وواجهة عربية بصلاحيات.
- [x] حالة AI مشتركة بإصدار وهوية فعلية، claims/checkpoints وتصريف دائم يمنع عودة الجيل القديم بعد إعادة تشغيله.
- [x] اختبارات وحدات وتكامل ومتصفح وPostgreSQL وOdoo فعليان، وتجربة عشرة عملاء وترقيات مستقلة وفشل واستعادة ومجدول؛ الأدلة التفصيلية في التقرير.
- [x] مراجعة مستقلة وإصلاح الملاحظات، مع إبقاء النتائج منفصلة عن قبول الإنتاج.
- [ ] بناء صورة Odoo الكاملة من الصفر: حجبه اتصال مستودعات Debian بعد محاولة محدودة؛ نجحت صورة قبول Docker بقاعدة مخبأة والمصدر الحالي.
- [ ] قبول حافة Caddy ومضيف الإنتاج والتخزين وHA وجودة مزود الذكاء الفعلي. لم يُنشر شيء ولا يُستنتج القبول من اختبار محلي.
- [ ] دمج هذه الحزمة مع main الجديد بعد إعادة التسمية إلى WebVue: غير مفوض في هذه المهمة، ويلزم نقل الأسماء ومراجعة التعارضات ثم فحوص التكامل.

الخانات الأصلية أدناه وصف خطوات التصميم والتحقق المطلوب؛ لا تُعلّم كُلها آليًا لأن بعض البنود تجمع التنفيذ مع إثبات نشر كامل. الأسماء التنفيذية المعتمدة هي `tools/continuous_updates_acceptance/run.py` ومحرك `ReleaseEngine`، بدلاً من واجهة `run.mjs` الافتراضية في التصميم الأول. جدول التقرير يفصل كل نتيجة متحققة عن بوابتها المتبقية. إعداد CI في الفرع قالب فقط؛ لا تفعيل لخادم أو GitHub Actions أو push.

## Global Constraints

- «بدون توقف» يعني استمرار القراءة والحفظ والجلسات، ولا يشمل إيقاف الحفظ أو انتظار الترقية خلف شاشة.
- لا تعديل لمصدر Odoo، ولا override خاص لإدارة الأجيال، ولا SQL جديد على جداول Odoo؛ فحص اتصالات PostgreSQL وإدارة أدوار الاتصال عمليات بنية مستقلة.
- لا أعمدة ظل أو مسارات توافق أو flags لإبقاء سلوك قديم؛ مخرجات النشر القديمة المؤقتة خارج المصدر وتنظف بعد التصريف وفق التفويض.
- قاعدة وfilestore مستقلان لكل عميل؛ تحويل الإصدار لا يغيرهما ولا يغير الاستحقاق أو `registryRevision`.
- لا تنفيذ اختبارات على `odoo19`. كل تجربة على موارد scratch معزولة ومنافذ ومجلدات مستقلة، خارج المصدر المحمي.
- مسار non_saas يعمل بلا خدمة التحكم؛ التوجيه لا يتجاوز الإبطال أو يفشل مفتوحًا.
- لا commit أو push أو merge أو deploy أو حذف موارد دون تفويض الإجراء.
- لا يعلن online لمجرد غياب تغيير schema؛ يلزم إثبات API والجلسة ودلالة الكتابة المشتركة والمهام.

## Review Focus

1. صفحة قديمة تطلب JS chunk وترسل حفظًا أثناء التحويل: الأصل موجود والحفظ مرة واحدة والمسودة باقية — المهام 2 و3 و6.
2. cron أو AI أو effect قديم يعود بعد fence: يرفض قبل أثر الكتابة، بما فيه اتصال قاعدة موجود — المهمتان 4 و5.
3. تغيير مسار الإصدار يقطع الجلسة أو يحفز `.pending` عالميًا: لا تغيير لهوية العميل أو إخراج المستخدم — المهمة 3.
4. وفاة المنسق بعد ترحيل القاعدة وقبل نشر مسارها: لا عودة إلى الكود القديم ولا إعادة ترحيل عمياء — المهمة 5.
5. فشل بعد استئناف الكتابة الجديدة: لا استعادة تلقائية للّقطة تفقد الكتابات المؤكدة — المهمتان 5 و6.

## ملكية الملفات والعقود المشتركة

الخطة واحدة لتبعياتها؛ التنفيذ المقترح inline حتى تثبت واجهات المهام 1–3، ثم يمكن تكليف مراجعة مستقلة. هذه خريطة مسؤوليات مستقبلية وليست dispatch أو موافقة تعديل الآن.

| الحزمة | ملفات المسؤولية | ما تنتظره |
|---|---|---|
| عقد الإصدار وتصنيفه | جديد `deploy/releases/{__init__,manifest,test_manifest}.py`، جديد `deploy/releases/README.md` | قرار سياسة الصيانة |
| مجموعات التشغيل | تعديل `deploy/docker-compose.shared.yml` و`deploy/shared/{validate_odoo_config.py,launch_odoo.py,Dockerfile}`؛ جديد `deploy/releases/{compose,readiness,test_compose,test_readiness}.py` | عقد الإصدار |
| المخصص وbootstrap | تعديل `deploy/docker-compose.yml` و`deploy/Caddyfile`؛ جديد `deploy/releases/{dedicated,test_dedicated}.py` | نفس عقد الإصدار، وbinding محلي موثوق |
| التوجيه والتصريف | تعديل `deploy/shared/{guard.mjs,start.mjs,Caddyfile}`؛ جديد `deploy/shared/{release-routes,release-routes.test}.mjs`؛ تعديل اختبارات guard؛ تعديل utilities التوجيه الحالية في `apps/web/server/utils` واختباراتها عند الحاجة | المجموعات والعقد |
| سلطة النشر والفصل | جديد `deploy/releases/{state,engine,cli,fencing,test_state,test_engine,test_fencing}.py` | التوجيه والتصريف |
| interlock للأعمال القائمة | تعديل `tools/shared_saas_lifecycle/{odoo_effect,subscription_effect,admin_password_effect,odoo_backup}.py` واختباراتها؛ عند الحاجة تعديل `apps/control-plane/src/shared/odoo-adapter.ts` و`apps/control-plane/src/commercial/usage-collector.ts` واختباراتهما (usage يستخدم observe في subscription effect) | سلطة runtime في المهمة 4؛ لا تغيير سلطة الموافقات التجارية |
| استمرار AI | تعديل `apps/web/server/utils/ai/{upstream,executor,pump}.ts` واختباراتها، و`apps/ai-service/src/webvue_ai_service/{service,store}.py` واختبارات recovery/store/service، وCompose | مجموعات التشغيل ونسخ الحالة وfencing |
| النسخ والترقية | جديد `deploy/releases/{backup,migrate,test_backup,test_migrate}.py`؛ تعديل caller في `tools/shared_saas_lifecycle/odoo_backup.py` فقط بعد فصل عقد النسخ بشكل صالح | الفصل الحقيقي للعميل |
| القبول والتشغيل | جديد `tools/continuous_updates_acceptance/`؛ تعديل `.woodpecker.yml` و`deploy/OPERATIONS.md` و`docs/testing.md` و`docs/migrations.md` | جميع الحزم السابقة |

كل ملف جديد في الجدول **مقترح غير موجود بعد**. ملفات مشتركة يملكها المنسق فقط. أي تعديل مطلوب في المنتج خارج التوجيه/استمرار الجلسات يُثبت بالتحقيق قبل إضافته؛ لا إدخال عمود حالة نشر في موديلات التطبيقات. ملف `docs/WORKSPACE.md` لا يحدّث إلا بعد أدلة تنفيذ لاحقة.

العقود المنطقية بين الحزم، بأسماء الحقول المقترحة:

- `ReleaseManifest`: `releaseId`, `webvueCommit`, `odooCommit`, `images` ببصمات ثابتة، `assetsId`, `moduleVersions`, `upgradeModules`, `installModules`, `mode: online|tenant_maintenance|service_maintenance|infrastructure_maintenance`, `affectedServices`, `aiStateVersion`, `compatibilityEvidence`, `rollbackPolicy`.
- `ReleaseRoute`: `tenantId`, `identityRevision`, `routeRevision`, `releaseId`, `poolId`, `state: serving|maintenance`, `fence`. لا Host/DB بديل في هذا السجل. سلطة الهوية الحالية تحل الهوية أولًا.
- `PoolConfig`: `poolId`, `releaseId`, وعناوين Nuxt/Odoo/WS/AI الداخلية من allowlist مشغل؛ AI قد يشير لمجموعة ثابتة لم تتغير. `SessionConfig` ومراجع filestore وDB runtime role من إعداد موثوق، لا من المتصفح.
- `RolloutRequest`: `requestId`, `manifestDigest`, `tenantIds`, `expectedRoutes` بمراجعاتها، `approvedMode`. `requestId` ثابت لإعادة الطلب نفسه؛ تغيير payload بنفسه مرفوض.
- `RolloutReceipt`: حالة التنفيذ ومرحلة كل عميل و`fence` وبصمات المصدر/الهدف وإثباتات readiness/backup/migration، دون أسرار أو بيانات عميل.
- قاعدة SQLite هي مصدر حالة rollout/route الوحيد؛ ملفات route المنشورة projections لحد البيانات وليست سلطة مستقلة. manifest immutable مدخل، وsnapshots المطلوبة مدخلات فحص وليست نسخًا أخرى لحقيقة الأعمال.

## Task 1: عقد الإصدار وتصنيف أثره

**Interfaces:** `load_manifest(path) -> ReleaseManifest`، `classify_release(base_root, target_root, manifest) -> ReleaseDecision`؛ القرار يحمل `eligible`, `mode`, `reasons`, `affected_modules`. يستهلك الجذور المحلية المثبتة، دون fetch تلقائي.

- [ ] اكتب اختبارات رفض الصور غير المثبتة، وonline مع `upgradeModules`/`installModules`، وXML/security/manifest dependency أو field change غير مصرح، وغياب دليل التوافق. سمّ الاختبارات `test_online_rejects_module_operations` و`test_unknown_change_is_blocked` وما يماثلهما.
- [ ] شغّل `python3 -B -m unittest deploy.releases.test_manifest -v` وتأكد أن الفشل بسبب عدم وجود الوظيفة المطلوبة.
- [ ] نفّذ parser والتصنيف المحافظ، واحسب إغلاق التبعيات من manifest الحقيقي وstock Odoo، وألزم المراجع بإقرار التوافق الدلالي للتغييرات التي لا يحسمها التحليل الساكن. لا `-u all` تلقائيًا.
- [ ] أعد الأمر نفسه؛ النجاح يتطلب رفض الحالات الخطرة وقبول مثال CSS ومثال Python مثبت التوافق.

**التسليم:** dry-run يذكر مكونات النشر والوحدات التي ستُرقّى ونطاق الصيانة وسبب التصنيف قبل أي أثر.

## Task 2: مجموعات تشغيل وجاهزية فعلية واستمرار الجلسات

**Interfaces:** `render_pool(manifest, operator_config) -> ComposeBundle`، `probe_pool(pool, tenant_binding) -> ReadinessEvidence`. ملف البيئة يحوي مراجع أسرار فقط، ولا تطبع أسرار في المخرجات.

- [ ] اكتب `test_pool_generation_has_independent_services` و`test_candidate_is_not_ready_on_tcp_only` و`test_session_store_is_shared_without_identity_change`. probe يبدأ برفض مجموعة لا تملك صورة/مخطط/جلسة مطابقة حتى لو TCP مفتوح.
- [ ] شغّل `python3 -B -m unittest deploy.releases.test_compose deploy.releases.test_readiness -v` وتحقق من فشل الحالات المطلوبة قبل التنفيذ.
- [ ] نفّذ مجموعتي تشغيل على مضيف التجربة، بميزانية RAM/CPU/اتصالات تكفي للإقلاع المتزامن. HTTP بلا cron، مع مسار جلسات مشترك آمن وfilestore صحيح وأصول hashed محفوظة للصفحات المفتوحة. لا تشغّل الجديد على قاعدة عميل قبل تصريح التوافق.
- [ ] افصل تهيئة HTTP المشترك عن cron/migration عبر خيارات Odoo العامة؛ لا تضع `db_name` في ملف HTTP الذي يرفضه الحارس الحالي، ولا تلغِ شرط الحماية لإرضاء render.
- [ ] أعد الاختبارات، ثم تجربة scratch لجلسة واحدة تقرأ على المجموعتين بنفس الهوية وتصل إلى المرفق نفسه. سجّل حدود اعتماد التخزين المحلي. ممنوع اعتبار `compose config` أو TCP دليل جاهزية أعمال.
- [ ] نفّذ adapter المخصص في `dedicated.py`: binding محلي ثابت، Caddy يحدد المجموعة والصيانة وNuxt يثبت عناوين Odoo/AI، مع إبقاء cookie Odoo الحالية. شغّل `python3 -B -m unittest deploy.releases.test_dedicated -v`؛ يلزم رفض Host آخر وعدم تجاوز الصيانة على direct Odoo/auth/content، ثم قبول scratch دون شبكة vendor.
- [ ] اختبر bootstrap من التكوين الحالي بمجموعة ثانية بنفس الإصدار؛ سجّل مراحل تغيير أدوار DB والجلسات والحافة، وصنّف أي إعادة تشغيل للنسخة الوحيدة كصيانة أولية مستقلة. لا تنفذها على مورد قائم ضمن اختبار محلي.

**التسليم:** نسختان محددتان تعملان معًا، واختبار يمنع مجموعة ناقصة من استقبال عميل.

## Task 3: تحويل الإصدار مع ثبات الهوية وتصريف الطلبات

**Interfaces:** `readReleaseRoute(directory, tenantId)` و`selectReleaseRoute(tenant, route, pools)` في `release-routes.mjs`؛ نتيجة الاختيار ثابتة طوال الطلب. ملفات كاملة لكل عميل دون cache، وحاجز صيانة لكل عميل. النشر الدائم CAS تملكه المهمة 4، والقارئ يرفض لقطة ناقصة أو fence غير صالح لهذا العميل وحده.

- [ ] اكتب اختبارات `release-routes.test.mjs`: `keeps_identity_revision_on_release_cutover`, `rejects_request_controlled_pool`, `pins_ssr_api_content_and_ws_to_same_release`, `does_not_publish_global_identity_pending`, `does_not_retry_non_idempotent_write`.
- [ ] شغّل `node --test deploy/shared/release-routes.test.mjs deploy/shared/guard.test.mjs` وتحقق من الفشل المقصود.
- [ ] نفّذ selector والتحقق المشترك في guard ومسار Nuxt الحالي. لا طلب يختار عنوانًا من header متصفح؛ تضاف بيانات القفزة الداخلية بعد إزالة الواردة ويُتحقق منها بالسلطة الحالية.
- [ ] نفّذ قارئ الحاجز/اللقطة بحسب ترتيب النشر في التصميم §5.3. online لا ينشئ حاجز رفض: لقطة قديمة كاملة تبقى مصرحًا بها قبل اكتمال التحويل؛ migration يرفض العميل قبل فتح أي أثر قاعدة. أضف اختبارات `partial_target_route_does_not_block_other_tenants` و`maintenance_barrier_precedes_any_migration`.
- [ ] نفّذ drain عند تحديث guard واستبدال صورته، وتهيئة Caddy للتبديل دون قتل الطلبات، مع معالجة streams. لا تعلن نجاح WS/AI لمجرد إعادة TCP.
- [ ] أعد الاختبارات مع اختبار cookies وregistry المتوفرة، ثم صفحة scratch مفتوحة قبل النشر تحفظ وتطلب chunk قديمًا بعده. تغيير release وحده لا يزيد `registryRevision` ولا يعطل سجل الهوية.
- [ ] أعد استعمال reconnect/replay في `apps/web/app/composables/useBus.ts` واختبر توافق نسخة worker والرسائل، ولا تنشئ بروتوكول WS موازيًا.

**التسليم:** تغيير إصدار لعميل دون إخراج جلساته، مع بقاء الإبطال والحدود الأمنية.

## Task 4: محرك نشر دائم وملكية cron/jobs وأجيال الاتصال

**Interfaces:** `plan_rollout(request, observed) -> RolloutPlan`، `advance_rollout(request_id, observations) -> RolloutReceipt`، `reconcile_rollout(request_id) -> RolloutReceipt`. CLI: `python3 -B -m deploy.releases.cli plan|apply|status|reconcile --request <path>`؛ apply لا ينفذ إلا الأثر المعتمد في request وبوابة المشغل.

- [ ] اكتب `test_conflicting_rollout_is_refused`, `test_stale_fence_cannot_write`, `test_existing_old_db_connection_is_not_accepted_as_fenced`, `test_online_never_stops_shared_odoo`, `test_restart_reconciles_after_route_cas`.
- [ ] شغّل `python3 -B -m unittest deploy.releases.test_state deploy.releases.test_engine deploy.releases.test_fencing -v`، وتحقق من الفشل قبل التنفيذ.
- [ ] نفّذ SQLite بمعاملات وCAS وقفل عميل وقفل نشر وreceipts دائمة. المراحل `planned → prepared → serving_new → draining_old → verified`، مع `blocked/needs_intervention` صريحين. عامل واحد نشط على مضيف المنسق؛ لا انتهاء قفل بوقت وحده يسمح لمالك متوقف مؤقتًا بالعودة.
- [ ] افصل desired عن observed دون نسخ حقيقة الأعمال: سجل intent قبل temp/fsync/rename، ولا تسحب صلاحية القديم online حتى guard acknowledgments والتصريف. اختبر التعطل قبل/بعد intent commit وfsync/rename/ack، وأن عميلًا غير مستهدف لا يرفض طلبًا بسبب ملف المستهدف. لا تعيد نشر ملف أقدم عند فشل قراءة الحالي.
- [ ] عرّف عضوية cron/jobs لكل عميل وإصدار، وافصلها عن HTTP. امنع صلاحية اتصال القديم بعد انتقال ملكية العميل، وأثبت تصريف المعاملات الموجودة؛ إعداد cron لا يكتشف كل القواعد دون قيد. AI/usage/one-off effects داخلة في الخريطة، ولا queue جديدة تكرر عمل الطابور الموجود.
- [ ] نفّذ preflight يرفض runtime superuser/CREATEDB/CREATEROLE أو وراثة/ملكية تلتف على منع الاتصال، وافصل bootstrap/upgrade credentials عن الخدمة. حاصر اتصال كل مجموعة في قواعد عضويتها وأثبت المنع بعد تصريف اتصالات الجيل القديم؛ online لا يقطع اتصالات طلبات جارية. اختبر Odoo الحقيقي بأقل صلاحيات تشغيل لازمة قبل اعتماد هذا التقسيم.
- [ ] صِل بوابة runtime بجميع Python effects القائمة ومسار usage، وبعامل AI قبل أي كتابة أعمال؛ `tenant_operation(binding, fence, operation)` هو عقد الدخول المشترك. اختبر `test_existing_effect_and_rollout_are_mutually_exclusive` و`test_suspended_effect_cannot_resume_after_fence`. لا تعتبر advisory lock خدمة التحكم أو حجزها القديم مشتركًا مع SQLite دون هذه الوصلة.
- [ ] نفّذ التحويل online مع بقاء القديم للطلبات الجارية، وإيقاف التوسع عند أي فشل. لا تستعد لقطة قاعدة في هذا المسار. التراجع التوجيهي مشروط بقبول القديم للبيانات التي كتبها الجديد.
- [ ] أعد الاختبارات، ثم اقتل المنسق في scratch عند كل حد حالة وتحقق من مصالحة واحدة ومن عدم ازدواج أثر الأعمال؛ يظل العامل القديم المعلّق مرفوضًا عند عودته.

**التسليم:** rollout online قابل للاستئناف ومقيّد النطاق دون توقف أو double write.

### Task 4A: خدمة AI وحالة runs/checkpoints

**Files:** ملفات AI في خريطة الملكية. **Interfaces:** اختيار عنوان `serviceFetch` من مجموعة الإصدار المثبتة؛ `aiStateVersion` يضبط توافق store/checkpointer. بوابة runtime تدير drain وتتبع ملكية الأعمال ولا تنسخ حالة run في مخزن نشر آخر.

- [ ] أضف اختبارات لتثبيت عنوان AI داخل الطلب، واستمرار run/claim عبر مجموعتين متوافقتين، ورفض schema/checkpoint mismatch قبل `setup`، وعدم إعادة تنفيذ أداة طالبت بها النسخة القديمة.
- [ ] شغّل اختبارات BFF المركزة من `apps/web`، واختبارات الخدمة الموثقة في `apps/ai-service/README.md` على قاعدة حالة scratch؛ تحقق من الفشل المحدد أولًا ثم نفّذ ربط المجموعات والتصريف مستخدمًا leases/claims/recovery القائمة.
- [ ] أعد الاختبارات وتجربة streaming نشطة؛ التوافق يجب أن يشمل تنسيق checkpoint ونتائج الأدوات، ولا يكفي HTTP health. حدد مسار تهيئة schema مرة واحدة قبل إدخال الصورة الجديدة، دون تنفيذ setup متعارض من النسختين.
- [ ] أضف تجربة `service_maintenance` لتغيير حالة غير متوافق: توقف AI فقط على كل عملاء قاعدة AI المعنية، وتستمر قراءات وكتابات ويب فيو الأخرى؛ لا تفتح AI قبل تحقق الحالة والاسترجاع. إصدار لا يملك هذا الدليل يُحجب، ولا تُغيّر تسميته إلى صيانة عميل Odoo.

**التسليم:** استمرار AI المتوافق، وحد صريح للتوقف الجزئي عندما تتغير قاعدة حالته المشتركة. المهمة 5 والقبول النهائي ينتظران هذه المهمة.

## Task 5: صيانة العميل والنسخ المتسق وترقية Odoo والاسترجاع

**Interfaces:** `quiesce_tenant(binding, fence) -> QuiescenceEvidence`، `capture_tenant(binding, fence) -> BackupEvidence`، `migrate_tenant(binding, manifest, fence) -> MigrationEvidence`، `verify_tenant(binding, manifest) -> AcceptanceEvidence`؛ backup لا يقبل إلا دليل quiescence مطابقًا لنفس fence.

- [ ] اكتب `test_backup_does_not_stop_other_tenants`, `test_upgrade_expands_dependency_closure`, `test_migration_failure_keeps_target_in_maintenance`, `test_old_pool_is_denied_after_migration`, `test_post_resume_restore_requires_incident_decision`.
- [ ] شغّل `python3 -B -m unittest deploy.releases.test_backup deploy.releases.test_migrate -v` وتحقق من الفشل المقصود.
- [ ] نفّذ `maintenance → quiesced → backed_up → migrating → validating → serving_new → verified`. web/cron/AI/effects للعميل تُصرف وتُمنع من إعادة الدخول. عند انتهاء مهلة التصريف، لا تبدأ migration ولا تقتل عملية أعمال لتكمل النشر.
- [ ] أنشئ حاجز العميل الدائم وfsync ثم اجمع إقرار مشاهدته والتصريف والفصل قبل migrate. بعد القبول لا تزل الحاجز إلا عقب نشر route الجديد وتثبيت digest/fence وأذونات الجيل ومشاهدة الجهات له. اختبر الموت عند كل حد، وبقاء حاجز العميل بعد إعادة التشغيل دون توقف بقية العملاء؛ لا TTL لرفعه.
- [ ] استخرج التحقق من نسخ DB/filestore والصور من المنطق الموجود حيث يصلح، واستبدل داخل ملكية الملف المسار الذي يوقف كل Odoo قبل استخدامه للنشر. لا تحويل النسخ اليدوي UNVERIFIED إلى trusted بمجرد تغيير label، ولا رفع حدود scratch إلى production دون اختبارات.
- [ ] شغّل Odoo upgrade في عملية واحدة `--no-http --stop-after-init --max-cron-threads=0` مع قاعدة وصورة وإضافات محددة، باستخدام خيارات عامة وبيئة scratch أولًا. اجمع module states والتحذيرات ودليل البيانات، ولا تعامل فشل منتصف الترحيل كعملية قابلة للإعادة عمياء.
- [ ] نفّذ استرجاعًا إلى هدف معزول والتحقق من DB+filestore+صورة ومرفقات، ثم طريقة إعادة الهدف المعتمدة دون تغيير binding الهوية خلسة. قبل فتح الخدمة يمكن استرجاع الحالة المتسقة وفق الدليل؛ بعد فتح الكتابة لا استرجاع آلي يفقد الأعمال الجديدة.
- [ ] أعد الاختبارات، ثم ترقية عميل من عشرة وفشل مصطنع فيها مع حمل قراءة/حفظ على التسعة؛ قس الصيانة والاستعادة وسجل كل الطلبات والكتابات.

**التسليم:** صيانة عميل واحد مع دليل استعادة، واستمرار بقية العملاء. لا يدّعي تسليم هذه المهمة zero downtime للعميل الذي تتم ترقية قاعدته.

## Task 6: تمرين قبول كامل وبوابات الإصدار ودليل المشغّل

### متطلب إضافي سابق للتسليم: نافذة صيانة يختارها العميل

مستمد من طلب المالك اللاحق، وتفصيله في التصميم §7. يضاف إلى نطاق التسليم بعد تثبيت عقده، ولا يبدأ بناء واجهته اعتمادًا على افتراض ملكية غير محسوم.

- [ ] قبل تنفيذ هذه الحزمة حدد المالك الفعلي لتفضيل الصيانة وAPI وصلاحيات مسؤول العميل وقصة Storybook للإعداد؛ أثبت اتساق المسار مع R5 وnon_saas. اعرض قرار المعمارية إذا احتاج استثناء جديدًا، ولا تنشئ endpoint من العميل إلى خدمة التحكم ضمن استثناء تجاري غير مناسب.
- [ ] حدد سياسة آخر موعد للتحديث ونسخ الإصدار المدعومة والتحديثات الأمنية العاجلة والإشعار مع المالك؛ لا تختلق عدد أيام أو تأجيلًا غير محدود. اكشف هذه السياسة قبل تأكيد الحجز.
- [ ] أضف واجهة اختيار نافذة متكررة وموعد خاص بمنطقة IANA، مع حجز UTC وحالة واضحة وتقدير مقاس. اختيار المواعيد محصور بسعة التشغيل وبمسار ترقية مدعوم؛ أخطاء DST أو تعارض الحجز صريحة.
- [ ] اجعل المجدول يستدعي `plan_rollout` و`advance_rollout` نفسيهما عند الموعد، مع إعادة preflight وCAS وفحص الإلغاء؛ إعادة المهمة لا تكرر الأثر. بعد دخول migrating لا تقطع العملية استجابة لتعديل موعد.
- [ ] اختبر عميلين بموعدين مختلفين، ومحاولة تجاوز الصلاحيات، وإلغاء متزامن مع البدء، وإعادة تشغيل المجدول، وDST، وامتلاء السعة، وفشل preflight، وتجاوز النافذة. صيانة مورد/AI مشتركة تعرض نطاقها الجماعي ولا تعد نافذة مستقلة لكل عميل.

ملكية الملفات والأوامر المركزة لهذه الحزمة تُثبت بعد بوابة التصميم أعلاه؛ ليست مهمة جاهزة للبناء في غياب مالك API/التفضيل. لا تؤخر هذه الفجوة عرض خطة التشغيل للمراجعة، لكنها تمنع الادعاء بأن الجدولة مشمولة بالتنفيذ المكتمل.

**Files:** الأدوات والوثائق وCI من خريطة الملكية؛ لا تبديل مسارات قبول قائمة دون حفظ تغطيتها الصحيحة، ولا إحياء recipes محذوفة بوصفها دليلًا قائمًا.

- [ ] اكتب harness معزولًا في `tools/continuous_updates_acceptance/run.mjs`، يبدأ بفشل تحقق كل شرط من القسم 7 في التصميم عند استخدام التكوين القديم، ويخرج `report.json` خاليًا من الأسرار.
- [ ] شغّل `node tools/continuous_updates_acceptance/run.mjs --scenario online` على الموارد الجديدة فقط؛ نفّذ مرحلتي load/rollout وراجع سجل الطلبات مقابل DB، لا uptime probe وحده.
- [ ] شغّل `node tools/continuous_updates_acceptance/run.mjs --scenario tenant-maintenance` ثم `--scenario failure-recovery`؛ أثبت عزل العميل وحفظ الأعمال والجلسات وWS وAI والملفات. أدخل تعطل guard والمنسق ورفض مصادقة/سعة وموت كاتب قديم ضمن التقرير.
- [ ] أضف سيناريوهات `--scenario dedicated-non-saas` و`--scenario bootstrap` و`--scenario ai-state-maintenance`؛ لكل منها نتائج مستقلة ونطاق توقف صريح، مع حجب شبكة vendor للمخصص واختبار التعارض مع effects القائمة.
- [ ] ثبّت في CI بوابة dry-run والتصنيف والترقية والاسترجاع. إصدار قابل للنشر يفشل إذا غاب وسم الأساس بدل تخطي الاختبار؛ المثال الأول يحتاج baseline معروفًا ومصرحًا به. أثبت اختبارات مصدر Odoo الفعلي في الموارد المعزولة.
- [ ] وثّق أوامر التشخيص والتراجع وحدود التوقف في `deploy/OPERATIONS.md` و`docs/migrations.md`، وميّز liveness عن readiness وقدرة الأعمال؛ سجّل حدود non_saas والتخزين المحلي والموارد المطلوبة.
- [ ] المنسق يراجع diff الفعلي ثم يشغّل gates المتأثرة مرة واحدة: الاختبارات المركزة، `npm test`، فحوص الأنواع للأجزاء المعدلة، و`python3 -B tools/arch_policy.py --base main` و`python3 -B tools/git_policy.py --base main`. تغييرات addon/contract إن ظهرت تحتاج مراجعتها المتخصصة وفق تعليمات المشروع.
- [ ] مراجعة مستقلة للفرع وتجربتان كاملتان قبل إعلان قبول محلي؛ قبول الاستضافة الفعلية والنشر يحتاجان تفويضًا ودليلًا منفصلين. لا تشغيل إنتاج من هذه الخطة.

**التسليم:** تقرير قابل للتدقيق يحدد التغييرات online والتغييرات التي تتطلب صيانة وزمنها المقاس ونطاقها، دون تعميم دليل محلي إلى الإنتاج.

## بوابات القرار وترتيب العمل

1. مراجعة هذا التصميم وسياسات استثناء صيانة العميل، وصيانة AI المشتركة، والانتقال الأول المحتمل؛ لا يبدأ تنفيذ runtime قبلها. رفض استثناء يحجب مساره حتى إثبات بديل، ولا يعد قبول بقية الخطة موافقة ضمنية عليه.
2. المهام 1–3 تجهّز العقود والمجموعات والتحويل. لا نشر لعملاء فعليين بها وحدها.
3. المهمتان 4 و4A ثم قبول online جزئي معزول. المهمة 5 تضيف الترقية والنسخ دون توقف بقية العملاء؛ ترحيل حالة AI غير المتوافق له صيانة خدمة معلنة.
4. المهمة 6 قبول تكاملي مستقل؛ إذا فشل شرط يُحجب نوع الإصدار المتأثر ولا تُخفّض المعايير لتسميته online.
5. تعيين بنية الاستضافة والموارد وسياسة RPO/RTO ونوافذ الصيانة الاستثنائية بنطاقها قبل قبول تشغيلي فعلي.

لا تقدير مدة تنفيذ أو مدة توقف لكل عميل قبل التمرين. لا تشمل الخطة ترحيلًا حيًا عامًا للمخطط أو HA لقاعدة PostgreSQL، ولا authorise commits أو دمجًا أو نشرًا أو تنظيفًا.

# بوابة تسليم جولة الاختبار الموحد (t6)

- التاريخ: 2026-09-24 (توقيت محلي +03).
- الشجرة المحكومة: `/Users/tariq/code/nasq-team-saas-combined` على `codex/team-saas-combined`، HEAD `abde67b64155250f015b8ad213c26609532a124c`.
- الكاتب: `deepseek-verify` (بوابة أدلة read-only).
- **هذا تسليم أدلة، ليس Git integration وليس قبول SaaS:** لا دمج، لا commit، لا push، لا نشر، لا حذف، ولا تشغيل موارد. الوثيقة تنقل حالة ولا تنقل كودًا.

## §1 حدّ الجولة وما تدّعيه

**ما تدّعيه هذه الجولة:** تجميع الشجرة الموحدة من الشرائح الثلاث، اختبار الحدّ الفعلي بين TypeScript والمحوّل الحقيقي عبر subprocess، تشغيل المجموعات الكاملة، وتكامل PostgreSQL على قاعدة scratch محلية — كل ذلك local وغير مُلتزم به (uncommitted)، مع مراجعة مستقلة وتحقّق مستقل.

**ما لا تدّعيه:** لا تكامل حي مع Docker أو مزوّد، لا إنشاء عميل، لا G1–G5، لا `tenant.entitle`/تطبيق سياسة، لا مصالحة، لا `active`، لا نشر ولا DNS، ولا أي عمل ضمني جارٍ.

## §2 سلسلة الجولة وأحكامها (t1–t19)

| المهمة | المخرج | الحالة/الحكم | الدليل |
|---|---|---|---|
| t1 | تجميع الشجرة الموحدة + manifest | مكتمل؛ SHA-256 مطابق للمصادر | `combined-assembly-manifest.md` (داخل الشجرة الموحدة) + §1 من `saas-combined-verification.md` |
| t2 | اختبار الحدّ + المجموعات الكاملة | مكتمل؛ **pass** من t5 | `saas-combined-boundary-review.md` |
| t3 | تكامل PostgreSQL على scratch | مكتمل؛ مسجّل بحدوده | §6 من `saas-combined-verification.md` |
| t4 | تحقق مستقل من t2/t3 | مكتمل؛ كل معايير القبول passed مع F1/F2/F3 | `saas-combined-verification.md` |
| t5 | مراجعة مستقلة للحدّ/النتائج | **pass** على عقد t2؛ R1 غير حاجب | `saas-combined-boundary-review.md` |
| t7 | إصلاح F1 (رموز خروج الإيصال) | مكتمل؛ ثم **needs_revision** في t8 | `saas-combined-f1-repair-review.md` (جولة 1، تاريخية) |
| t8 | مراجعة t7 | needs_revision (F1-R1: إعادة كتابة رمزي 2/3 إلى 5) | نفس الملف، جولة 1 |
| t9 | إعادة إصلاح F1 (repair round 2) | مكتمل | تقرير t10 في نفس الملف |
| t10 | مراجعة t9 | **pass**؛ F1-R1 مغلق | `saas-combined-f1-repair-review.md` أعلى الملف |
| t11 | نقل HD-2/3 إلى adapter | **مغلق بالنقل**؛ `cli.py` و`test_nasq_cli.py` متطابقان SHA-256 في المصدر والموحد؛ نتائج CLI 30 وmanaged runtime 64 منفصلة | §13 في `saas-combined-verification.md` |
| t12 | نقل HD-1 إلى control | **مغلق بالنقل**؛ `service.test.ts` متطابق SHA-256؛ suite control 64 وPG skip معلن | §13 في `saas-combined-verification.md` |
| t13 | تغطية worker→المحوّل الحقيقي | التشغيل 3/3 صحيح، لكن مراجعة t15 وجدت السيناريو الثالث مضللًا؛ F3 لا تُغلق | §14 في verification، جولة 1 في `saas-combined-e2e-review.md` |
| t15 | مراجعة t13 | **needs_revision**؛ E2E-1: السيناريو الثالث ينجح بسبب `worker_error` من double بلا `COMMIT`، لا `deployment_incomplete` | `saas-combined-e2e-review.md`، جولة 1 |
| t17 | إصلاح E2E-1 حسب العقد المعدّل | **مكتمل**؛ حذف زراعة SQLite، وإثبات fail-closed preflight حقيقي فقط؛ F3 باقية مفتوحة | `saas-combined-e2e-review.md`، ملخص t18 |
| t18 | مراجعة t17 | **pass**؛ E2E-1 مغلق، وليس إثبات `deployment_incomplete` | `saas-combined-e2e-review.md`، جولة 2 |
| t19 | تصحيح دليل F3 | **مكتمل**؛ الإغلاق السابق لـF3 سُحب؛ F3 مفتوحة حتى دليل successful incomplete create | §14 في `saas-combined-verification.md` |

**الحالة الحالية:** لا إصلاح E2E-1 مفتوح بعد pass في t18، لكن F3 لمسار `deployment_incomplete` ما زالت مفتوحة. HD-1/2/3 مغلقة بالنقل المثبت؛ HD-4 يبقى لنقل اختبار `worker-real-adapter.test.ts` عند الدمج. لا قبول SaaS ولا دمج أو تشغيل حي مستنتج من هذه الحالات.

## §3 أدلة البوابات على الشجرة الحية (تشغيل حديث، منفردة)

كل ما يلي نُفِّذ على الشجرة كما هي اليوم (بعد إصلاح F1)، لا على لقطة قديمة:

### G1 — الحدّ الحقيقي عبر subprocess (منفردًا)

```
$ npm -w apps/control-plane run test -- --reporter=verbose src/__tests__/adapter-boundary.test.ts
 ✓ adapter-boundary.test.ts > real managed adapter subprocess boundary >
   binds policy bytes to the journal and returns a strictly read-only status receipt 346ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
$ grep -n "toBe(4)\|toBe(1)" apps/control-plane/src/__tests__/adapter-boundary.test.ts
129: expect(created.code).toBe(4)   154: expect(replayed.code).toBe(4)
161: expect(status.code).toBe(4)    178: expect(conflict.code).toBe(4)
$ grep -c "toBe(1)" … → 0     $ grep -c "toBe(4)" … → 4
```

الاستدعاء حقيقي: `spawnSync('python3', ['-B','-m','nasq_cli.managed_runtime', …])` بلا `vi.mock` وبلا `invokeAdapter`، والاختبار يقارن digest محسوبًا في TypeScript بعمود journal كتبه Python.

### G2 — اختبارات CLI (منفردة)

```
$ python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'
Ran 30 tests in 0.104s
OK
```

### G3 — المجموعة الكاملة

```
$ npm test
Ran 309 tests in 0.978s            → OK        (tools: يتضمّن CLI 30 + managed adapter 64 + بقية أدوات/حراس)
CATALOG_OK solutions=1 / PASS: no new static UI policy violations
Vue template syntax: 251 files, 0 errors / UI catalog: 43 components, up to date
> @nasq/contracts  Test Files 28 passed / Tests 178 passed
> @nasq/web        Test Files 128 passed / Tests 864 passed
EXIT=0
```

### G4 — تكامل PostgreSQL على scratch جديدة (منفردًا)

```
$ pg_isready → /tmp:5432 - accepting connections
$ psql -d postgres -Atc "SELECT count(*) FROM pg_database"     → 157
$ createdb -h 127.0.0.1 nasq_control_scratch_t6gate            → exit 0 ؛ العدّ → 158
$ CONTROL_TEST_DATABASE_URL="postgresql://tariq@127.0.0.1:5432/nasq_control_scratch_t6gate" \
  npm -w apps/control-plane run test -- --reporter=verbose
 Test Files  7 passed (7)
      Tests  76 passed (76)        PG_SUITE_EXIT=0
$ grep -c "✓ src/__tests__/service.test.ts" → 11     (غير متخطّى)
$ grep -cE "↓|skipped" → 0                            (لا skip في هذا التشغيل)
$ psql …-Atc "SELECT payload_digest,result->>'_control_lane' FROM operations WHERE payload_digest='markerless-fixture'"
markerless-fixture|
$ dropdb -h 127.0.0.1 nasq_control_scratch_t6gate              → exit 0
$ psql … "SELECT count(*) FROM pg_database"                    → 157 (مطابق)
$ psql … "SELECT datname … LIKE 'nasq\_control\_scratch\_%'"   → aebb2cfcb0 / merge923a / runtime_b72a6 (القائمة الثلاث، لم تُلمس)
$ pg_isready → accepting connections
```

**skip ليس قبولًا:** `npm run test:commercial` بلا `CONTROL_TEST_DATABASE_URL` يتخطى `service.test.ts` (t2/t9 سجّلاه صراحةً)؛ الدليل المعتمد للتكامل هو G4 أعلاه، وt4 G5 قبله على scratch أخرى أُسقطت.

### G5 — فحص مستقل خارج أي harness لرموز الخروج (يقفل F1 فعليًا)

نُفِّذت الوحدة الحقيقية يدويًا على الشجرة الحالية:

| الحالة | الأمر | رمز الخروج المرصود | stderr |
|---|---|---|---|
| create (preflight مغلق) | `… tenant create …` | 4 | `nasq-cli: preflight_unavailable` |
| receipt `status=conflict` بلا `error` | `… status …` | **4** | `nasq-cli: conflict` |
| إدخال غير صالح (`--target bad`) | `… status …` | **2** | `nasq-cli: target_unknown` |
| تفويض (`policy-bytes-file` بوضع `0666`) | `… status …` | **3** | `nasq-cli: descriptor_not_private` |

لا `Traceback` في أي حالة (`grep -c Traceback` = 0)، و`sha256(operations.sqlite3)` لم يتغير بعد إعادتين لـ`status` (قراءة فقط مؤكدة خارج الاختبار). مسار رمز 5 (فشل عملية لـ`status=error`) لم أُنتجه حيًّا؛ هو مغطّى باختبارات CLI الثلاثين ومراجعة t10 القرائية.

## §4 توافق الواجهة عبر الحد (Interface conformance)

| الخاصية | ما يثبته الدليل |
|---|---|
| استدعاء المحوّل الحقيقي في subprocess (لا double) | G1: `spawnSync python3 -B -m nasq_cli.managed_runtime`، والنسخة اليدوية في G5 |
| تطابق digest عبر الحد (bytes↔journal) | TS يعيد حساب `sha256(canonical({operation,target,request_id}) ‖ \0target\0 ‖ fingerprint ‖ \0file\0 ‖ u64be(len) ‖ bytes)` ويطابق عمود journal من Python |
| `operation` من الصف المخزون (A-1) | الإيصال يعيد `operation: 'tenant.create'` |
| `policy_verified=false` لا يُرفع | تأكيد صريح في الاختبار والمصدر؛ الحجر ما زال قائمًا |
| `status` لا يكتب (no-write) | لقطة ملفات+SQLite قبل/بعد متطابقة، وثبات sha للنشر/journal يعاد إنتاجه خارج الـharness |
| replay متطابق وconflict عند اختلاف البايتات | `operation_id` يبقى مع نفس البايتات، و`request_conflict`=4 عند تغيّرها |
| عقد رموز الخروج | 4/2/3 مرصودة حيًّا (G5)، و2/3 لم تُعد كتابتها — وهذا هو إصلاح F1-R1 |

**حدّ هذا التوافق:** تطابق الـdigest مُثبَت على إيصال `conflict` من `preflight_unavailable`، لا على create ناجح؛ المسبار الافتراضي مغلق قبل أي أثر في هذه الجولة.

## §5 حالة الأشجار الحية (2026-09-24 13:31)

```
combined : codex/team-saas-combined @ abde67b6 — 26 مدخلًا dirty (12 M + 14 ??)، staged=0، diff --check نظيف، بلا commit أو stash جديد
canonical: /Users/tariq/code/nasq  @ abde67b6  — 4 مدخلات pre-existing فقط (M vendor-control.test.ts، ?? vendor-outage.test.ts، ?? .agent-teams/، ?? roadmap) — لم تتغير
adapter  : codex/team-saas-adapter   @ abde67b6 — 7 dirty
control  : codex/team-saas-control   @ abde67b6 — 15 dirty
edge     : codex/team-saas-edge      @ abde67b6 — 3 dirty
evidence : codex/team-saas-evidence  @ abde67b6 — تقارير untracked
PG       : pg_isready سليم؛ pg_database = 157؛ nasq_control_scratch_* القائمة = 3 (aebb2cfcb0، merge923a، runtime_b72a6)
worktrees: 13 worktree كلها على abde67b6 (نفس قائمتها السابقة)
```

**لا دمج ولا push ولا نشر ولا حذف:** كل الشجرات على نفس الـcommit، و`origin/main` لم يُمَس، ولم تُنشأ/تُحذف فروع أو worktrees.

## §6 فروق النقل قبل الدمج (handoff deltas) — لا تنقل الجولة شيئًا بنفسها

تحديثًا على حالة t11/t12/t18: HD-1/2/3 **مغلقة بالنقل إلى الشرائح** مع تطابق بايتي موثق في `saas-combined-verification.md` §13. هذا لا يعني دمجًا إلى canonical. HD-4 حاليًا هو ملف اختبار worker E2E فقط، وليس اختبار adapter-boundary:

| البند | الملف | الحالة | الخطوة المتبقية |
|---|---|---|---|
| HD-1 | `apps/control-plane/src/__tests__/service.test.ts` | مغلق بالنقل إلى control (t12؛ SHA-256 متطابق) | لا نقل متبقٍ إلى الشريحة؛ إدماج الكود عند تفويض الدمج |
| HD-2 | `tools/nasq_cli/cli.py` | مغلق بالنقل إلى adapter (t11؛ SHA-256 متطابق) | لا نقل متبقٍ إلى الشريحة؛ إدماج الكود عند تفويض الدمج |
| HD-3 | `tools/test_nasq_cli.py` | مغلق بالنقل إلى adapter (t11؛ SHA-256 متطابق) | لا نقل متبقٍ إلى الشريحة؛ إدماج الكود عند تفويض الدمج |
| HD-4 | `apps/control-plane/src/__tests__/worker-real-adapter.test.ts` | موجود في combined، وليس ضمن ملفات control المنقولة؛ مستقل عن ملف الحدّ أدناه | نقل هذا الملف إلى control عند خطوة دمج مفوضة؛ المالك captain/orchestrator |

**تمييز لازم:** `adapter-boundary.test.ts` هو اختبار حدّ مباشر TS↔Python موجود من t2 (يمر subprocess ويختبر digest/journal)؛ `worker-real-adapter.test.ts` يستدعي `executeClaimed` ثم المحوّل الحقيقي، وهو ملف t13/t17 محل HD-4. لا يُعامل أحدهما كنسخة أو بديل عن الآخر. تطابق ملفات HD-1/2/3 البايتي باقٍ صحيحًا ولا يتأثر بتصحيح F3.

## §7 قائمة قرارات المتبقي — مرة واحدة

هذه قائمة الخطوات المتبقية، بمالك وخطوة تالية محددة؛ لا تمنح تفويضًا ضمنيًا للتشغيل الحي:

1. **F3 / إثبات successful incomplete create — المالك: control + captain لتنسيق العقد.** t17/t18 يثبتان fail-closed preflight فقط: `_probe` الافتراضي يرفض `catalog_sha256` بـ`preflight_unavailable` قبل runner. لا يثبت ذلك إيصال `status=ok` مع `deployment_ready !== true` أو `deployment_incomplete`. الخطوة: تحديد طريقة اختبار معتمدة لهذا المسار ثم تكليف تغطية ومراجعة مستقلة؛ لا تغيير للمسبار مفوض هنا.
2. **HD-4 — نقل ملف `worker-real-adapter.test.ts` إلى control — المالك: captain/orchestrator.** الخطوة: حمله عند دمج مفوض. لا تخلطه مع `adapter-boundary.test.ts` (اختبار boundary المباشر)، فهما اختباران منفصلان.
3. **RD-2/RD-7/RD-8 — المالك: product/captain.** الخطوة: حسم من يستدعي المصالحة ونطاقها، شكل دليل الصحة الدائم، ونافذة حداثة دليل الجاهزية؛ تبقى المصالحة محجوبة إلى ذلك الحين.
4. **تطبيق السياسة و`tenant.entitle` — المالك: control/product بعد حسم العقد.** الخطوة: تعريف الهوية والمحتوى وربط التطبيق؛ الحالة الحالية `policy_application_not_wired`. مسار `provisioned/active` غير مدعى.
5. **Package 4 — المالك: مالك الحزمة ومراجعها.** الخطوة: معالجة 8 شروط مراجعة و4 متطلبات تجميد قبل أي capture/restore.
6. **`non_saas` binding وcanonical dirt/`stash@{0}` — المالك: product/captain بحسب القرار.** الخطوة: حسم القرار البشري واستحقاقات المحتوى؛ لا تغييرات ضمن هذه البوابة.

أي تشغيل Docker/شبكة/خدمات أو عملاء يحتاج تفويضًا مستقلًا صريحًا لاحقًا؛ لا شيء في هذا التقرير يصرّح به.

(البند 1–6 مطابق لقائمة تسليم الدفعة السابق `saas-team-batch-delivery.md` §8 مع تحديث حالة ما أُنجز: PG integration واختبار الشجرة الموحدة لم يبقيا «غير منفَّذين».)

## §8 الحدود الصريحة — ما أثبتته الاختبارات وما لم تثبته

**أُثبت (محليًا فقط):** تجميع الشجرة؛ boundary subprocess مباشر لـ`adapter-boundary.test.ts` مع digest/no-write؛ حالات CLI المنفردة؛ المجموعات المسجلة في §3؛ وPG integration على scratch أُنشئت وأُسقطت (76 اختبارًا، 11/11 لـ`service.test.ts` في تشغيل مُعدّ بقاعدة صريحة). اختبار worker E2E المُراجع يثبت health وstatus غير المطابق، ويثبت fail-closed preflight لcreate. لا يُستنتج PG قبولًا من أي تشغيل skip.

**لم يُثبت:** successful incomplete create عبر العامل ولا `deployment_incomplete` (F3 مفتوحة)؛ قبول SaaS أو عميل أو خدمة حية؛ Docker/شبكة/صور؛ `tenant.entitle`/تطبيق سياسة؛ مصالحة أو انتقال إلى `provisioned/active`؛ نشر/DNS أو دليل إنتاج. نجاح t17 يثبت preflight refusal فقط لأن `_probe` الافتراضي يرفض `catalog_sha256` قبل runner؛ المراجعة المستقلة t18 أغلقت E2E-1 حسب العقد المعدل، لا F3.

**حالة HD والنتائج:** F1 مغلق بأدلة t9/t10/G5. HD-1/2/3 مغلقة بالنقل المطابق بايتيًا إلى control/adapter (verification §13). HD-4 هو `worker-real-adapter.test.ts` ويظل للنقل عند الدمج؛ لا يخلط مع `adapter-boundary.test.ts`. F3 تبقى مفتوحة حتى دليل successful incomplete create ومراجعة مستقلة مقبولة. لا يُعلن اكتمال SaaS أو التكامل الحي.

**حدود البوابة:** لا commit/merge/push/deploy، ولا تعديل source أو تشغيل شبكة/DB إضافية. تخطي PG في suite بلا env ليس قبولًا؛ فقط تشغيل scratch الصريح أعلاه دليل PG محدود. لا تفويض ضمني للمسبار أو سياسات المصالحة والجاهزية أو التشغيل الحي.

**لا عمل ضمني جارٍ:** لا job أو خدمة أو container أو منفذ أو قاعدة أُنشئت وبقيت في هذه البوابة؛ قواعد scratch المرتبطة بالأدلة السابقة أسقطت، والقواعد القائمة لم تُلمس.

## §9 الحكم

بوابة الأدلة **مكتملة** للجولة الموحدة على مستوى: التجميع + الحدّ الحقيقي + المجموعات الكاملة + تكامل PostgreSQL على scratch + تحقق ومراجعة مستقلين بحكم pass. التسليم **لا يرقّي ولا يدمج ولا ينشر**، وأي عمل حي (عملاء، G1–G5، entitlement/مصالحة) يحتاج القرارات في §7 وتفويضًا جديدًا.

## §10 المراجع

- `saas-combined-verification.md` (تحقق t4 المستقل + §11 بنود t6 + §12 تحديث ما بعد F1).
- `saas-combined-boundary-review.md` (مراجعة t5).
- `saas-combined-f1-repair-review.md` (t8 needs_revision ثم t10 pass).
- `combined-assembly-manifest.md` (manifest التجميع داخل الشجرة الموحدة).
- `saas-team-batch-delivery.md` / `saas-team-status.md` (تسليم الدفعة السابق وقائمة قراراته).

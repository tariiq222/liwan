# التحقق المستقل من الشجرة الموحدة (t4)

- التاريخ: 2026-09-24 (توقيت محلي +03).
- الشجرة المدققة: `/Users/tariq/code/nasq-team-saas-combined` على الفرع `codex/team-saas-combined`.
- المرجع (baseline): `abde67b64155250f015b8ad213c26609532a124c`.
- المدقق: `deepseek-verify` — تحقق read-only. لم يُعدَّل أي مصدر أو اختبار، ولم تُلمس `canonical` (`/Users/tariq/code/nasq`) ولا `.agent-teams` ولا أي مورد fixture/DB قائم.
- الوضع: هذه أول وثيقة أدلة محفوظة لهذا التكليف؛ ملف `saas-combined-verification.md` لم يكن موجودًا قبل الآن، ولا توجد أي مخرجات t2/t3 محفوظة في `docs/verification/` (أحدث ملف محفوظ قبل هذه الجولة هو `saas-team-status.md` بتاريخ 23 Sep 19:22 وسجّل PG integration كـ SKIPPED). لذلك أُعيد تشغيل البوابات الحرجة فرديًا لسد غياب الدليل، وسُجّلت النتائج منفصلة بلا جمع مضخّم.

## §0 تصنيف الأدلة (unit / PG integration / boundary)

| # | البوابة | التصنيف | هل تستدعي محوّلًا حقيقيًا؟ |
|---|---|---|---|
| G1 | `apps/control-plane/src/__tests__/adapter-boundary.test.ts` (ملف وحيد) | **boundary (subprocess حقيقي)** | نعم — `spawnSync('python3', ['-B','-m','nasq_cli.managed_runtime', …])` |
| G2 | إعادة إنتاج يدوية للمحوّل خارج أي harness اختبار | **boundary (subprocess حقيقي)** | نعم — نفس الوحدة عبر CLI |
| G3 | `npm test` (tools + guards + contracts + web) | **unit/static** | لا |
| G4 | `npm run test:commercial` بلا env | **unit** (PG **skipped**) | لا |
| G5 | `npm -w apps/control-plane run test` مع `CONTROL_TEST_DATABASE_URL` على scratch جديدة | **PG integration + unit** | لا (وحدة العامل عبر مسار scratch) |
| G6 | فحص حيّ لمُسند fail-closed على scratch PostgreSQL | **PG (نص SQL حرفي من `db.ts`)** | لا |
| G7 | دورة حياة قاعدة scratch (إنشاء/إسقاط/عدّ) | **infra (PG)** | — |

**PG skip ليس نجاحًا:** الأمر G4 لا يُحتسب دليل تكامل؛ الدليل الوحيد المعتمد للتكامل هو G5 (11 اختبارًا غير متخطٍ في `service.test.ts`).

## §1 حالة الشجرة والتفروقات (`git -C` بمسارات مطلقة)

```
$ git -C /Users/tariq/code/nasq-team-saas-combined rev-parse HEAD
abde67b64155250f015b8ad213c26609532a124c        # == baseline المسجل في manifest التجميع

$ git -C /Users/tariq/code/nasq-team-saas-combined diff --cached --stat
(فارغ: لا staged)

$ git -C /Users/tariq/code/nasq-team-saas-combined status --porcelain=v1 | wc -l
26        # 12 tracked-modified + 14 untracked، بلا أي commit جديد

$ git -C /Users/tariq/code/nasq-team-saas-combined diff --check
(فارغ، exit 0)

$ git -C /Users/tariq/code/nasq-team-saas-combined reflog -2
abde67b6 HEAD@{0}: reset: moving to HEAD
abde67b6 HEAD@{1}: (bootstrap)
```

الملفات المتتبعة المعدّلة (12): `apps/control-plane/src/{config,db,http,main,worker-main,worker}.ts`، `apps/control-plane/src/__tests__/service.test.ts`، `packages/commercial-contracts/src/index.ts`، `tools/nasq_cli/{cli,journal}.py`، `tools/test_nasq_cli.py`، `tools/test_nasq_cli_operator.py`.
غير المتتبعة (14): `apps/control-plane/src/{worker-loop.ts,__tests__/{adapter-boundary,config,db-outage,worker-managed}.test.ts}`، `apps/web/app/composables/__tests__/useVendorContext.test.ts`، `apps/web/app/middleware/__tests__/`، `deploy/control-plane-outage/`، `deploy/managed-local/`، `deploy/test_managed_local.py`، `docs/verification/combined-assembly-manifest.md`، `tools/nasq_cli/managed_runtime.py`، `tools/test_managed_runtime.py`، `tools/test_nasq_cli_scratch_guards.py`.

**الأشجار القديمة و canonical سليمة** (كلها على `abde67b6`، بلا commit جديد، وديرتيها كما كانتا قبل الجولة):

| الشجرة | HEAD | ملفات dirty |
|---|---|---|
| `/Users/tariq/code/nasq` (canonical, `main`) | `abde67b6` | 4 (`M vendor-control.test.ts`، `?? vendor-outage.test.ts`، `?? .agent-teams/`، `?? docs/superpowers/plans/…roadmap.md`) |
| `nasq-team-saas-adapter` | `abde67b6` | 7 |
| `nasq-team-saas-control` | `abde67b6` | 15 |
| `nasq-team-saas-edge` | `abde67b6` | 3 |

**تحقق من التجميع (t1) بـ SHA-256 مستقل:** قُورنت 32 من الملفات المدرجة في manifest مع نسخها في شرائح المصدر: 31 مطابقة بايتيًا، واختلاف واحد متوقع ومقصود فقط: `apps/control-plane/src/__tests__/service.test.ts` (تعديل t3 في الشجرة الموحدة فقط، انظر F2). مثال مطابقة معلنة داخل manifest: `tools/nasq_cli/cli.py` = `64aac3e210e32e0b…` وهو المطابق فعليًا.

**حالة استبعاد BFF (قرار §8.6):** `apps/web/server/utils/__tests__/vendor-control.test.ts` في الشجرة الموحدة مطابق تمامًا للـbaseline (`git diff` فارغ)، و`vendor-outage.test.ts` غير موجود في الشجرة الموحدة بينما نسخته القائمة محفوظة في canonical — أي أن الاستبعاد محصور بالشجرة الموحدة ولم يُحذف أو يُعدَّل أي مصدر.

## §2 دليل البوابة G1 — الحدّ الحقيقي عبر subprocess (منفردًا)

```
$ npm -w apps/control-plane run test -- --reporter=verbose src/__tests__/adapter-boundary.test.ts
 ✓ src/__tests__/adapter-boundary.test.ts > real managed adapter subprocess boundary >
   binds policy bytes to the journal and returns a strictly read-only status receipt 352ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  442ms
```

إثبات أنه **ليس double**: `spawnSync('python3', ['-B','-m','nasq_cli.managed_runtime', …])` بـ`cwd` جذر الشجرة و`PYTHONPATH=<worktree>/tools` (السطور 32–53 من الملف)، ولا يوجد `vi.mock`/`vi.fn` في الملف إطلاقًا؛ والاختبار يقرأ journal SQLite الحقيقي المكتوب من Python ويعيد حساب digest بـTypeScript (canonical JSON + `\0target\0` + fingerprint + policy bytes + descriptor bytes) ويقارنه بالقيمة المخزونة — أي تحقق عبور-لغة حقيقي. أما `worker-managed.test.ts` (7 اختبارات) فيستخدم حقن double عبر `config.invokeAdapter`، وهو **seam اختباري فقط** لا يُضبط من env (غير موجود في `getConfig`)؛ لذلك مسار الإنتاج في `worker.ts` يستدعي الوحدة الحقيقية بـ`runProcessGroup`.

## §3 دليل البوابة G2 — إعادة إنتاج المحوّل خارج أي harness

نُفِّذت نفس الوحدة يدويًا (نفس descriptor/inventory/policy bytes التي يبنيها الاختبار) في `/tmp`:

```
$ PYTHONPATH=<worktree>/tools NASQ_MANAGED_INVENTORY=<tmp>/inventory/managed.json \
  NASQ_CLI_STATE_DIR=<tmp>/state python3 -B -m nasq_cli.managed_runtime \
  tenant create --target tgt_boundary_test --policy-file <tmp>/policy-original.json \
  --request-id 8c9a7722-f4b1-49d4-a141-4db89639f55a --json
{"changed": false, "error": {"code": "preflight_unavailable", …}, "operation": "tenant.create",
 "operation_id": "op_36c1f5dfc8bb49ecabd851c5e1c8a70d", "request_id": "8c9a7722-…", "status": "conflict",
 "stage": "preflight", "target": "tgt_boundary_test"}
exit=4

# journal SQLite مقروء مباشرة:
[["tgt_boundary_test","8c9a7722-…","op_36c1f5dfc8bb49ecabd851c5e1c8a70d","tenant.create",
  "4090a11e221a8621ab6cf41b04290e8ac84cbcb720220e5367f1aa8f13049c31",
  "sha256:6ecd032aea236b4d5d559ba51f0f092eaae5868edfd128bbe5f4f8ca1d861798","conflict"]]

# status (قراءة فقط):
$ … managed_runtime status --target tgt_boundary_test --request-id 8c9a7722-… \
  --policy-bytes-file <tmp>/policy-original.json --json
{"digest":"4090a11e…","fingerprint":"sha256:6ecd032a…","operation":"tenant.create",
 "operation_id":"op_36c1f5dfc8bb49ecabd851c5e1c8a70d","policy_verified":false,"status":"conflict",…}
exit=1   # ← انظر F1: هذا الرمز ناتج استثناء غير معالج لا رمز الخروج الموثّق

# إثبات أن status لا يكتب: sha256(journal) قبل/بعد متطابق
f4ce1b806612521b0117d25ae3620eba861ab7e5becb7e95a4d07116a4a3be72 (before)
f4ce1b806612521b0117d25ae3620eba861ab7e5becb7e95a4d07116a4a3be72 (after)
```

مسار مختلف عن نجاح الـreceipt لكنه يمرّ عبر `_fail` (payload يحمل `error`) يعطي الرمز الصحيح وبلا traceback:

```
$ … status … --policy-bytes-file <tmp>/policy-different.json
{"error":{"code":"policy_digest_mismatch",…},"status":"conflict",…}
exit=4
stderr: nasq-cli: policy_digest_mismatch
```

## §4 دليل البوابة G3 — `npm test` (منفردًا)

```
$ npm test
Ran 306 tests in 0.949s
OK
CATALOG_OK solutions=1
PASS: no new static UI policy violations. Visual/behavior review still required.
Vue template syntax: 251 files, 0 errors
UI catalog: 43 components, up to date
> @nasq/contracts@0.1.0 test
 Test Files  28 passed (28)
      Tests  178 passed (178)
> @nasq/web@0.1.0 test
 Test Files  128 passed (128)
      Tests  864 passed (864)
EXIT=0
```

تشمل السلسلة: `tools` unit/guards (`secret_guard`, `no_external_refs`, `ui_policy`, `ui_inventory --check`, `ui_templates.mjs`, `ui_catalog.mjs --check`) ثم contracts ثم web.

## §5 دليل البوابة G4 — `npm run test:commercial` بلا env (PG **مُتخطّى**)

```
$ npm run test:commercial
> @nasq/commercial-contracts@0.1.0 test
 Test Files  1 passed (1)
      Tests  4 passed (4)
> @nasq/control-plane@0.1.0 test
 ↓ src/__tests__/service.test.ts (0 test)          ← SKIPPED
 ✓ src/__tests__/config.test.ts (47 tests)
 ✓ src/__tests__/receipt.test.ts (2 tests)
 ✓ src/__tests__/worker-managed.test.ts (7 tests)
 ✓ src/__tests__/adapter-boundary.test.ts (1 test)
 ✓ src/__tests__/db-outage.test.ts (7 tests)
 ✓ src/__tests__/process-group.test.ts (1 test)
 Test Files  6 passed | 1 skipped (7)
      Tests  65 passed (65)
EXIT=0
```

هذه النتيجة تطابق ما أبلغ عنه t2 (4 contracts + 65 control مع skip)، وتُسجَّل هنا صراحةً على أنها **ليست** دليل تكامل PostgreSQL.

## §6 دليل البوابة G5 — تكامل PostgreSQL على scratch جديدة (منفردًا)

قاعدة جديدة باسم فريد: `nasq_control_scratch_t4verify` (اسم يطابق الحارس الذاتي في الاختبار: loopback + `^nasq_control_scratch_[a-z0-9]+$`).

```
$ CONTROL_TEST_DATABASE_URL="postgresql://tariq@127.0.0.1:5432/nasq_control_scratch_t4verify" \
  npm -w apps/control-plane run test -- --reporter=verbose
 Test Files  7 passed (7)
      Tests  76 passed (76)
   Duration  1.26s        # EXIT=0، بلا أي skip في هذا التشغيل
```

اختبارات `service.test.ts` غير المتخطاة (11/11، أسماؤها من المُخرَج):

```
✓ requires a valid signature, stores nonce, and denies replay
✓ revocation denies the next signed request
✓ registers tenant and durably deduplicates queued operation by actor, tenant and payload
✓ rejects tenant classification mismatch before registration
✓ rejects a globally reused request ID across actors without exposing the original
✓ rechecks the grant immediately before worker execution
✓ never records a late worker success after its mutation lease expires
✓ blocks new and previously queued mutations after an unresolved lease
✓ persists an inspected feature map directly with its revision
✓ fails closed for incomplete create without the trusted scratch lane marker
✓ retains verified desired and observed policy after incomplete create without activating tenant
```

إثبات أن الاختبار كتب فعلًا في قاعدتي (قبل الإسقاط):

```
$ psql -h 127.0.0.1 -d nasq_control_scratch_t4verify -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
audit_events / catalog_entries / operation_events / operations / restore_approvals /
schema_migrations / service_nonces / tenants / vendor_memberships
$ … "SELECT count(*) FROM operations"                      → 7
$ … "SELECT payload_digest,result->>'_control_lane' FROM operations WHERE payload_digest='markerless-fixture'"
markerless-fixture|                                        ← markerless فعلًا
```

ملاحظة إضافية: تعديل t3 على fixtures يطابق مخرجات العامل الحقيقية — `worker.ts:264-271` تكتب `result._control_lane='scratch'` لمسار scratch في `tenant.create`، و`db.ts:49` يشترط `status==='ok' && policy_verified===true && deployment_ready===false && _control_lane==='scratch'`.

## §7 دليل البوابة G6 — الفحص الحي لمُسند fail-closed (10 متغيرات)

الطريقة: استُخرج نص الـSQL حرفيًا من `apps/control-plane/src/db.ts` آليًا (لا نسخ يدوي)، ونُفِّذ على قاعدة scratch جديدة `nasq_control_scratch_t4classify` بجدول `operations` مطابق (نفس أعمدة الاستعلام). هذا فحص SQL حيّ بلا تجميع مضخّم، وليس تشغيلًا للدالة المترجمة؛ أما الدالة الحقيقية فقد اختُبرت end-to-end في G5 (markerless ⇒ 409/reconciliation_required).

النص المستخرج:

```sql
SELECT 1 FROM operations
    WHERE tenant_id=$1 AND status='needs_intervention'
      AND type IN ('tenant.create','tenant.entitle','backup','upgrade','restore')
      AND NOT COALESCE(
        type='tenant.create' AND stage='deployment_incomplete'
        AND result->>'status'='ok' AND result->>'policy_verified'='true'
        AND jsonb_typeof(result->'deployment_ready')='boolean'
        AND result->'deployment_ready'='false'::jsonb
        AND result->>'_control_lane'='scratch',
        false
      )
    LIMIT 1
```

النتائج (blocked=1 ⇒ ما يزال unresolved):

```
a_false_scratch        blocked=False  exempt        result={"status":"ok","policy_verified":true,"deployment_ready":false,"_control_lane":"scratch"}
b_missing_ready        blocked=True   unresolved    (لا حقل deployment_ready)
c_null_ready           blocked=True   unresolved    deployment_ready=null
d_text_false           blocked=True   unresolved    deployment_ready="false"
e_true_ready           blocked=True   unresolved    deployment_ready=true
f_number_zero          blocked=True   unresolved    deployment_ready=0
g_no_lane              blocked=True   unresolved    deployment_ready=false بلا _control_lane
h_managed_lane         blocked=True   unresolved    _control_lane="managed"
i_wrong_stage          blocked=True   unresolved    stage≠deployment_incomplete
j_policy_unverified    blocked=True   unresolved    policy_verified=false مع lane=scratch
ALL_VARIANTS_MATCH_EXPECTATION
```

هذا يؤكد ادعاء t3 (C-1): `false` منطقي + `_control_lane='scratch'` وحده معفى.

## §8 دليل البوابة G7 — دورة حياة قاعدة scratch وبلا لمس موارد قائمة

```
$ pg_isready                                    → /tmp:5432 - accepting connections (exit 0)
$ psql -d postgres -Atc "SELECT count(*) FROM pg_database"    → 157 (قبل)
$ createdb -h 127.0.0.1 nasq_control_scratch_t4verify         → exit 0 ؛ العدّ → 158
$ createdb -h 127.0.0.1 nasq_control_scratch_t4classify       → exit 0
$ dropdb   -h 127.0.0.1 nasq_control_scratch_t4classify       → exit 0
$ dropdb   -h 127.0.0.1 nasq_control_scratch_t4verify         → exit 0
$ psql -d postgres -Atc "SELECT count(*) FROM pg_database"    → 157 (بعد، مطابق)
$ psql -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname IN ('…t4verify','…t4classify')"  → 0
$ psql -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'nasq\_control\_scratch\_%'"
nasq_control_scratch_aebb2cfcb0
nasq_control_scratch_merge923a
nasq_control_scratch_runtime_b72a6      ← نفس القواعد الثلاث القائمة قبل الجولة، لم تُلمس
$ pg_isready                                    → accepting connections (exit 0)
```

## §9 النتائج (findings)

**F1 — medium — رمز خروج غير صحيح + traceback في مسار `status` للـreceipt المستقرّ (شريحة adapter).**
`tools/nasq_cli/cli.py:316-317` يطبع `payload["error"]["code"]` عند أي `exit_code != 0`، لكن مسار `_status` الناجح-المتعارض في `managed_runtime.py:646-724` يعيد `_payload(...)` بـ`status: conflict`/`needs_intervention` **بلا** حقل `error`. النتيجة: استثناء `KeyError: 'error'` غير معالج ⇒ traceback على stderr ورمز خروج 1 من الاستثناء، بينما الخريطة الموثّقة `JOURNAL_EXIT = {ok:0, conflict:4, needs_intervention:6}` تفرض 4/6. الأثر: العقد الموثّق لرموز الخروج مكسور في مسار قراءة-فقط، و`adapter-boundary.test.ts:161` يثبّت `expect(status.code).toBe(1)` أي يوثّق عَرَض الخطأ. لا خطر تنشيط: العامل يعامل أي رمز ≠ 0 كـ`receipt_unverified` (fail-closed). خطوة واحدة: في `cli.py` استخدم `payload.get('error', {}).get('code', payload.get('status','error'))` (أو أجّل الطباعة لمسار `CliError` فقط)، وبدّل التأكيد إلى `toBe(4)` مع إضافة اختبار CLI يغطي receipt متعارضًا. المالك: مالك شريحة adapter/captain.

**F2 — medium — (تاريخي؛ أُغلق بالنقل t12).**
كان فرق fixtures من t3 محصورًا في الشجرة الموحدة. في t12 نُقل `apps/control-plane/src/__tests__/service.test.ts` إلى شريحة control؛ تحقق SHA-256 الحي أدناه يثبت أن ملفي الشجرتين متطابقان الآن. دليل PG التاريخي G5 يظل خاصًا بالشجرة الموحدة ولا يُعاد وصفه كتشغيل على شريحة control. المتبقي للنقل عند الدمج هو HD-4 فقط، وليس إصلاح F2.

**F3 — low — مفتوحة: تغطية السيناريو الثالث في العامل→المحوّل الحقيقي غير مثبتة (t15 needs_revision).**
كان تقرير t14 قد وصف اختبار t13 بأنه يغطي ثلاثة سيناريوهات، لكن مراجعة `saas-combined-e2e-review.md` وجدت أن السيناريو الثالث لا يثبت مسار incomplete create المقصود. انظر التصحيح الصريح في §14؛ نتيجة إعادة التشغيل 3/3 صحيحة كواقعة تشغيلية فقط وليست دليلًا على صحة هذا السيناريو. F3 تنتظر إصلاح t17 وإعادة مراجعة t18.

**F4 — info — لا نتائج أخرى.** لا `sudo`/Docker/عملاء/نشر؛ لا تعديل على source أو canonical أو `.agent-teams`؛ لا DB قائمة لُمست؛ لا commit/staged/merge/push.

## §10 الحدود المتبقية (لا ادعاء زائد)

- G5 يثبت تكامل PostgreSQL لكنه على **قاعدة scratch محلية**، وليس دليل نشر إنتاجي.
- G3/G4 اختبارات وحدة/عقود/واجهة، ولا تُغني عن G1/G2 للتكامل العبور-لغوي.
- G6 فحص SQL حيّ بنص مستخرج حرفيًا؛ ليس تشغيلًا للدالة المترجمة (تلك مُغطاة في G5 للحالة markerless).
- لم يُشغَّل أي تفاعل حيّ مع Docker أو مزوّد أو خدمة خارجية.

## §11 بنود بوابة التسليم t6 (إحالة صريحة من captain — 2026-09-24)

حدود هذه الجولة ثابتة: **unit + PG integration على قاعدة scratch + boundary حقيقي فقط**؛ لا G1–G5 (مسارات الصور/التوجيه/الخروج)، ولا عملاء حقيقيون، ولا دمج أو ترقية.

### T6-1 — نقل فرق `service.test.ts` مع أي ترقية لشريحة control (HD-1) — **مغلق بالنقل t12**

أُعيد فحص SHA-256 بعد نقل t12: نسخة الشجرة الموحدة ونسخة `/Users/tariq/code/nasq-team-saas-control/apps/control-plane/src/__tests__/service.test.ts` متطابقتان (`8470a2c3…59d7ca`). النقل إلى الشريحة مُنجز. تبقى ملاحظة حدود الاختبار: suite control عند t12 مرّ بـ64 اختبارًا مع تخطي PG لعدم `CONTROL_TEST_DATABASE_URL`؛ دليل PG 76 اختبارًا/11 service غير متخطية يخص scratch في الشجرة الموحدة حسب §6، لا تشغيلًا حيًا على شريحة المصدر. عند الدمج تُنقل ملفات/فروق المصدر المقررة فقط وبالتفويض.

**التفصيل التاريخي للفرق:**

ترقية شريحة control اعتمادًا على شجرتها (`/Users/tariq/code/nasq-team-saas-control`) تتطلب **نقل فرق t3 نفسه معها** في `apps/control-plane/src/__tests__/service.test.ts`:

- سطر واحد في fixture السيناريو الذي يمثل مخرجات العامل: إضافة `_control_lane:'scratch'` إلى نتيجة `finishClaim` (`+` عند السطر 183 في الشجرة الموحدة)؛
- حالة جديدة من 14 سطرًا: إدخال صف markerless مباشرة في PG والتأكد من 409/`reconciliation_required` (`fails closed for incomplete create without the trusted scratch lane marker`)؛
- إجمالي الفرق: **16 سطرًا** (`git diff` في §1) — بلا أي تغيير آخر في الملف.

الأثر التاريخي إن غاب النقل: نسخة control القديمة كانت تكتب نتيجة بلا علامة lane، وG6 (المتغير `g_no_lane`) + G5 (409 للحالة markerless) يثبتان أن الـbackup اللاحق سيعود 409 لا 202 ⇒ سقوط الاختبار. هذا النقل أُنجز لاحقًا في t12 كما هو مثبت في §13؛ الدمج إلى canonical ما زال بتفويض captain لاحقًا وخارج نطاق هذه الجولة.

### T6-2 — فجوة تغطية worker→المحوّل الحقيقي (F3) — **مفتوحة؛ تنتظر t17 وإعادة مراجعة t18**

الاختبار في `apps/control-plane/src/__tests__/worker-real-adapter.test.ts` يستدعي subprocess حقيقيًا في المسارين الأول والثاني، لكن السيناريو الثالث رُفض في مراجعة t15 (راجع §14). لا يُحتسب F3 مغلقًا حتى يصحح t17 المسار ويجتاز t18 مراجعة مستقلة. لا تغيّر هذه الحالة HD-1/HD-2/HD-3 أو نتائج نقلها. ملف الاختبار نفسه HD-4 ويبقى مطلوبًا نقله عند الدمج بتفويض captain؛ لا دمج هنا.

### HD-2 / HD-3 — نقل إصلاح F1 واختبارات CLI إلى adapter — **مغلق بالنقل t11**

تحقق SHA-256 حيًّا من `tools/nasq_cli/cli.py` و`tools/test_nasq_cli.py` بين combined وadapter؛ كلا الملفين متطابق بايتيًا (انظر §13). أدلة t11 المنفردة المنقولة: `python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'` — 30 اختبارًا OK؛ `python3 -B -m unittest discover -s tools -p 'test_managed_runtime.py'` — 64 اختبارًا OK؛ `ruff check tools/nasq_cli` — pass؛ `git diff --check` — pass. هذه نتائج كل أمر منفرد، وليست جمعًا. النقل للشرائح أُنجز؛ يبقى إحضار تغييراتها إلى canonical جزءًا من دمج لاحق مفوّض، لا خطوة نفذت هنا.

### T6-3 — إدراج نتيجة t7/t8 عند اكتمالهما (إصلاح F1 ومراجعته) — **مُنجز**

عند اكتمال t7 (إصلاح F1) وt8 (مراجعته) تُدرَج هنا الأدلة الفعلية فقط، ويشمل ذلك بالحد الأدنى:

1. فرق إصلاح `tools/nasq_cli/cli.py` (منع `KeyError` على payload بلا `error`، بحيث يصبح رمز الخروج المطابق لـ`JOURNAL_EXIT` = 4 للمتعارض و6 لـ`needs_intervention`)؛
2. تعديل تأكيد اختبار الحد داخل الشجرة الموحدة (`adapter-boundary.test.ts:161` من `toBe(1)` إلى `toBe(4)`)، وإثبات أنه يعطي الرمز الموثّق مع receipt متعارض فعلًا؛
3. **ترقية الإصلاح إلى شريحة adapter (`/Users/tariq/code/nasq-team-saas-adapter`) تتطلب نقل الفرق نفسه** لها: `tools/nasq_cli/cli.py` + `apps/control-plane/src/__tests__/adapter-boundary.test.ts` (الشريحة لا تحمل الملف الثاني لأنه أُضيف في الشجرة الموحدة)؛
4. **إعادة تشغيل G1 (وأي بوابة تمسّ `cli.py`) وتسجيل المخرجات من جديد** بعد الإصلاح، لأن أرقام §2/§3 الحالية (رمز خروج 1) تخصّ الشجرة قبل الإصلاح عند `abde67b6` + dirty.

حالة هذا البند الآن: **مُنجَز** — اكتملت t7/t8/t9/t10، وأُدرجت الأدلة وإعادة التشغيل المستقلة على الشجرة بعد الإصلاح في §12 أدناه (2026-09-24).

## §12 تحديث ما بعد إصلاح F1 — إعادة تشغيل على الشجرة الحالية (بوابة t6)

أُعيد تشغيل البوابات المتأثرة بعد أن غيّر t7/t9 ملفَّي `cli.py` و`test_nasq_cli.py` وأكمل t10 مراجعته بحكم **pass**. كل ما يلي على الشجرة الحالية (HEAD ما زال `abde67b6`، 26 مدخلًا dirty، staged=0):

```
# G1 الحدّ (منفردًا) — التأكيد صار 4
$ npm -w apps/control-plane run test -- --reporter=verbose src/__tests__/adapter-boundary.test.ts
 Test Files 1 passed (1) / Tests 1 passed (1) — 346ms
$ grep -n "toBe(4)" apps/control-plane/src/__tests__/adapter-boundary.test.ts
129, 154, 161, 178 → toBe(4)   (لا toBe(1) في الملف)

# G2 اختبارات CLI
$ python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'   → Ran 30 tests / OK

# G3 المجموعة الكاملة
$ npm test → Ran 309 tools / OK / contracts 178 / web 864 / EXIT=0

# G4 تكامل PG على scratch جديدة (nasq_control_scratch_t6gate)
$ CONTROL_TEST_DATABASE_URL=… npm -w apps/control-plane run test -- --reporter=verbose
 Test Files 7 passed (7) / Tests 76 passed (76) — خدمة service.test.ts 11/11 غير متخطاة، 0 skip، صف markerless موجود
$ dropdb → exit 0 ؛ pg_database 157→158→157 ؛ قواعد nasq_control_scratch_* الثلاث القائمة لم تُلمس

# G5 فحص مستقل خارج harness لرموز الخروج (يقفل F1 عمليًا)
create (preflight مغلق)        → exit 4 / stderr: nasq-cli: preflight_unavailable
status = conflict بلا error    → exit 4 / stderr: nasq-cli: conflict   (لا Traceback)
status بـtarget غير صالح       → exit 2 / stderr: nasq-cli: target_unknown
policy-bytes-file بوضع 0666    → exit 3 / stderr: nasq-cli: descriptor_not_private
sha256(operations.sqlite3) ثابت بعد إعادتين لـstatus ⇒ القراءة فقط مؤكدة
```

**حالة النتائج بعد هذا التحديث (2026-09-24):** F1 **مغلق** (t9 + t10 pass + G5 أعلاه)؛ F2 **أُغلقت مسألة نقله إلى شريحة control في t12** (والـPG integration يبقى بالدليل المسجل في §6 للشجرة الموحدة)؛ F3 **أُغلقت فجوة التغطية المحددة** باختبار t13 في §13، مع حدود واضحة؛ HD-4 يبقى اختبارًا جديدًا في combined يجب نقله عند الدمج. أرقام §2/§3/§9 الأصلية تبقى لقطات تاريخية قبل الإصلاح حيث نص التقرير على ذلك. مسار رمز 5 لم يُنتَج حيًّا هنا؛ تغطيته عبر اختبارات CLI الثلاثين ومراجعة t10 القرائية. بوابة التسليم المجمّعة في `saas-combined-delivery.md`.

## §13 أدلة النقل وتغطية worker→المحوّل (t11–t13)

سُجلت النتائج المنقولة بحسب كل أمر مستقل؛ لا تُجمع مجموعات متداخلة في رقم واحد.

### t11 — نقل HD-2/HD-3 إلى adapter

فحص بايتي حيّ بين `/Users/tariq/code/nasq-team-saas-combined` و`/Users/tariq/code/nasq-team-saas-adapter`:

```
tools/nasq_cli/cli.py       SHA-256 06a3e84977067df029093acab1dbead083f3754c82bd903a82de3a83a8c1d355 (متطابق)
tools/test_nasq_cli.py     SHA-256 cde5f587b9c5a02c314de6a792b979e187e029a4d15c57712942ba4d5d761cc1 (متطابق)
```

أوامر t11 المنفردة المنقولة: `python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'` — 30 اختبارًا / OK؛ `python3 -B -m unittest discover -s tools -p 'test_managed_runtime.py'` — 64 اختبارًا / OK؛ `ruff check tools/nasq_cli` — pass؛ `git diff --check` — pass. هذه نتائج تشغيل t11 على شريحة adapter، وليست إعادة تشغيل في هذه الجولة. بذلك HD-2 (`cli.py`) وHD-3 (`test_nasq_cli.py`) **مغلقان بالنقل إلى adapter**. لا يعني النقل أن الدمج إلى canonical حدث.

### t12 — نقل HD-1 إلى control

فحص بايتي حيّ بين combined و`/Users/tariq/code/nasq-team-saas-control/apps/control-plane/src/__tests__/service.test.ts`:

```
SHA-256 8470a2c3c5f2dab1bb2360dfe4a415023b3ac2d736451b89747d59efed59d7ca (متطابق)
```

أمر t12 المنفرد المنقول: `npm -w apps/control-plane run test` — suite control-plane: 64 اختبارًا، و`service.test.ts` تخطّي PG صراحةً لغياب `CONTROL_TEST_DATABASE_URL`؛ `git diff --check` — pass. هذه نتيجة t12 على شريحة control وليست تشغيل PG. لذلك HD-1 **مغلق بالنقل**؛ دليل PG integration الحقيقي ما زال فقط كما هو مصنف في §6 (scratch على combined).

### t13 — اختبار السلسلة الكاملة وإعادة تشغيل مستقلة

الملف المضاف في combined فقط: `apps/control-plane/src/__tests__/worker-real-adapter.test.ts`. يعبر `executeClaimed` إلى `nasq_cli.managed_runtime` حقيقي عبر `spawnSync(python3 -B -m …)`؛ لا mock للمحوّل، مع PG doubles فقط، journal SQLite وinventory وسياسة مؤقتة خاصة (`0600`). لا Docker أو شبكة أو DB حية أو عملاء.

نتيجة t13 المنقولة من تنفيذ المهمة: الاختبار الجديد 3 سيناريوهات ناجحة؛ suite control-plane الكاملة 7 files / 68 tests pass مع `service.test.ts` متخطى لغياب PG env؛ `npm test`: 309 tools + guards، 178 contracts، 864 web pass؛ `git diff --check` pass. هذه أرقام تشغيل t13 وليست جمعًا بينها.

إعادة التشغيل المستقلة في هذه الجولة، أمر منفرد داخل combined:

```
$ npm -w apps/control-plane run test -- --reporter=verbose src/__tests__/worker-real-adapter.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
 EXIT=0
```

تُحفظ نتيجة التشغيل التاريخية كما وردت: health receipt صحيح يسجل succeeded، وreceipt status conflict غير الموثق يُحجر `needs_intervention/receipt_unverified`؛ كما أظهر التشغيل 3/3. **لكن نجاح الاختبار الثالث لا يثبت create غير الجاهز أو مرحلة `deployment_incomplete`**؛ مراجعة t15 (التقرير أدناه) أثبتت أن التأكيد نجح بسبب `worker_error` الناتج عن PG client double بلا دعم `COMMIT`، وليس بسبب المسار المقصود. لذا لا تُعدّ 3/3 دليلًا يغلق F3. لا يثبت التشغيل تكامل PG أو قبول SaaS أو سلوك خدمة حية.

### حالة HD-1..HD-4 والشجر الحي بعد t13

| البند | الوضع الحالي | ما بقي |
|---|---|---|
| HD-1 `service.test.ts` | مغلق بالنقل إلى control (t12، hash أعلاه) | لا دمج إلى canonical دون تفويض؛ PG skip في suite الشريحة لا يساوي تكاملًا |
| HD-2 `cli.py` | مغلق بالنقل إلى adapter (t11، hash أعلاه) | الدمج إلى canonical لاحقًا فقط |
| HD-3 `test_nasq_cli.py` | مغلق بالنقل إلى adapter (t11، hash أعلاه) | الدمج إلى canonical لاحقًا فقط |
| HD-4 `worker-real-adapter.test.ts` | موجود في combined، غير موجود في control بحسب نطاق t13 | يُنقل إلى شريحة control في مرحلة الدمج بتفويض؛ مالك الخطوة captain/orchestrator |

لا يؤثر تصحيح نتيجة t15 على hashes أو أحكام نقل HD-1/HD-2/HD-3 أعلاه؛ تظل الأدلة البايتية ونتائج t11/t12 كما سُجلت.

فحص Git live لهذه الجولة: combined `codex/team-saas-combined` عند `abde67b64155250f015b8ad213c26609532a124c`، 27 مسارًا dirty (12 modified + 15 untracked)، ولا staged؛ adapter عند baseline نفسه و7 مسارات dirty؛ control عند baseline نفسه و16 مسارًا dirty؛ canonical `/Users/tariq/code/nasq` على `main` عند baseline نفسه و4 مسارات pre-existing dirty. `git diff --check` مرّ لكل من combined/adapter/control/canonical. لا commits أو merge أو push أو deploy أو حذف؛ لم تُمس canonical. هذه لقطات حالة وقت الفحص وليست ادعاءً بأن أشجار المصدر نظيفة.

## §14 تصحيح حكم t14 بعد مراجعة t15 (E2E-1) — 2026-09-24

يُقرأ هذا التصحيح مع الاحتفاظ بسجل التشغيل في §13، ولا يمحو مخرجاته أو يغيّر أرقامها: الاختبار نُفذ ونتيجته **1 file / 3 tests passed** فعلًا. لكن هذا الرقم يثبت أن assertions الحالية مرت، لا أن السيناريو الثالث اختبر السلوك المدعى.

وفق `saas-combined-e2e-review.md`، المسار الثالث يزرع receipt في SQLite ثم يستدعي `executeClaimed` من جديد؛ العامل لا يستهلك الصف المزروع، بل يعيد استدعاء المحوّل ويحصل على receipt conflict. بعد ذلك يحاول `finishClaim` إتمام معاملته، لكن `PoolClient` double لا يدعم `COMMIT`، فيرمي وتلتقطه كتلة catch كـ`worker_error`/`needs_intervention`. لذلك ينجح التأكيد بسبب تعطل الـdouble، **لا** لأن العامل نفّذ `deployment_incomplete`. بل إن التأكيد الحالي ينفي هذه المرحلة صراحةً. الخلل E2E-1 عالي الشدة حسب المراجعة.

**الحكم المصحح:** F3 **مفتوحة**. سيناريوهات health وstatus غير المطابق تظل مدعومة بمراجعة t15؛ أما معيار create غير الجاهز دون `active` فلم يُثبت. تنتظر F3 إصلاح t17 وإعادة مراجعة مستقلة t18؛ لا يُعاد فتح HD-1/HD-2/HD-3 ولا تتغير hashes أو نتائج النقل البايتي المثبتة في §13. نتيجة t14 السابقة («إغلاق F3») مستبدلة بهذا الحكم، وتبقى ظاهرة كسجل تاريخي فقط.

**حدود هذه الإضافة:** تصحيح وثائقي فقط. لا source/test edits، ولا إعادة تشغيل اختبارات، ولا PostgreSQL أو شبكة أو Docker أو عملاء، ولا commit/merge/push/deploy. تقرير t16 لاحقًا يسجل نتيجة الإصلاح والمراجعة فقط بناءً على دليلها؛ لا يعلن الإغلاق دون قبول مستقل.

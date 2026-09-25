# مراجعة مستقلة لاختبار الحد الفعلي (t5)

- التاريخ: 2026-09-24.
- المراجع: `grok-review`. مراجعة read-only. لم يُعدَّل أي مصدر أو اختبار في الشجرة الموحدة، ولم تُلمس `canonical` ولا `.agent-teams` ولا أي قاعدة.
- الشجرة المحكومة: `/Users/tariq/code/nasq-team-saas-combined` على `codex/team-saas-combined`، HEAD `abde67b64155250f015b8ad213c26609532a124c`.
- المهمة المراجعة: **t2** (implementation، attempt 2). أدلة t4 في `docs/verification/saas-combined-verification.md` مصدر تحقق، لا حكم.
- العقد الحاكم: عقد t2 في تكليف الفريق، و`docs/superpowers/specs/saas-team-batch-contract.md` لربط البايتات و`policy_verified=false`. Revision 3.1 لا يُعاد فتحه.

## الحكم

**pass** على عقد t2 كما نُفِّذ على الشجرة الموحدة. معايير الحدّ والمجاميع مطبقة، ونتائج PG مُصنَّفة بصدق. العيب المفتوح أدناه لا يكسر معيار قبول t2 ولا يُغلق به.

لا يُعاد فتح A-1: إيصال `status` يحمل `operation` من الصف المحفوظ (`managed_runtime.py:719-720`)، والاختبار يثبت `tenant.create`. لا يُعاد فتح C-1: إعفاء scratch موثّق في t4 كـPG integration، وليس قبولًا من skip.

## ما طُبّق من معايير t2

| المعيار | الحكم | الموقع |
|---|---|---|
| استدعاء المحوّل الحقيقي عبر subprocess | مطبق | `adapter-boundary.test.ts:32-42` — `spawnSync('python3', ['-B','-m','nasq_cli.managed_runtime', …])` مع `PYTHONPATH=tools` و`NASQ_MANAGED_INVENTORY` و`NASQ_CLI_STATE_DIR`. لا `vi.mock` ولا `invokeAdapter`. |
| journal مؤقت وملف سياسة `0600` | مطبق | `mkdtemp` ثم `chmod 0o600`، والتأكيد في السطر 124. لا Docker ولا عميل. |
| تطابق digest عبر الحد | مطبق | TypeScript يعيد حساب `sha256(canonical({operation,target,request_id}) ‖ \0target\0 ‖ fingerprint ‖ \0file\0 ‖ u64be(len) ‖ bytes)` ويقارنه بعمود journal المكتوب من Python (`:135-148`). هذا يطابق `journal.py:39-51`. |
| انحدار A-1 | مطبق | `status` يعيد `operation: 'tenant.create'` (`:162-163`). المصدر يضع `receipt_fields['operation'] = row['operation']` قبل بناء الإيصال. |
| `policy_verified=false` | مطبق | التأكيد في `:169`، والمصدر يمرّر `policy_verified=False` في `:724`. لا حقل يدّعي تطبيق السياسة. |
| no-write بعد status | مطبق | لقطة ملفات وSQLite قبل/بعد (`:158-173`) متطابقة، بما فيها عمود `receipt`. t4 أعاد إنتاج ثبات `sha256(journal)` خارج الـharness. |
| replay بمسار مختلف | مطبق | نفس البايتات من `policy-replay-copy.json` تحافظ `operation_id` (`:151-156`). |
| conflict باختلاف البايتات | مطبق | `request_conflict` ورمز 4، واللقطة لا تتغير (`:175-180`). |
| المجموعات منفردة وبلا قبول من skip | مطبق في التسجيل | t2 سجّل `service.test.ts` skipped. t4 أعاد `npm test` (306 + 178 + 864، EXIT=0) و`test:commercial` (4 + 65 مع skip) وصنّف skip كغير-نجاح. |

مسار الاستدعاء يطابق `operator()` في الإنتاج من جهة الوحدة والوسيطات والبيئة (`worker.ts:131-142`)، لكنه **ليس** مرورًا عبر `worker.ts`. ذلك حدّ المحوّل، وهو ما يطلبه عقد t2 حرفيًا. تغطية العامل→المحوّل end-to-end تبقى فجوة مسجّلة في t4 (F3، low) ولا تُعاد هنا كعيب جديد: `worker-managed.test.ts` يستخدم double محقونًا، ومسار الإنتاج لا يُضبط من env.

استبعاد ملفي BFF (`vendor-control.test.ts` أُعيد إلى HEAD، و`vendor-outage.test.ts` حُذف من الشجرة الموحدة فقط) موثّق في `combined-assembly-manifest.md` ويُبقي الحارس دون إضعافه. ليس قبولًا لدمج هذين الملفين.

## تصنيف الأدلة (لا يُخلط)

| الدليل | التصنيف | هل يُحتسب قبولًا؟ |
|---|---|---|
| `adapter-boundary.test.ts` وإعادة إنتاج t4 اليدوية | boundary عبر subprocess حقيقي | نعم لمعايير الحدّ في t2 |
| `npm test`، lint، build، ruff، edge 4، adapter 64 | unit/static | نعم لبوابات t2 المسجّلة، لا لعبور اللغة |
| `npm run test:commercial` بلا `CONTROL_TEST_DATABASE_URL` | unit؛ `service.test.ts` **skipped** | ليس قبول تكامل PostgreSQL |
| t4 G5: scratch `nasq_control_scratch_t4verify`، 7 ملفات / 76 اختبارًا، `service.test.ts` 11/11 غير متخطٍ | PG integration | نعم لمسند الخدمة على scratch محلية، لا لنشر |
| t4 G6: SQL مستخرج حرفيًا من `db.ts:53-64`، 10 متغيرات | فحص SQL حيّ، ليس الدالة المترجمة | يؤكد أن `false` البولياني + `_control_lane='scratch'` وحده معفى |

`policy_verified=false` مع digest مطابق هوية طلب فقط. الحجر لا يُرفع: `worker.ts:260-267` يجبر `policy_verified=false` و`deployment_ready=false` و`_control_lane='managed'`، والتفعيل في `:202` يشترط الاثنين `true`. لا مصالحة ولا تفعيل managed في هذه الجولة.

## العيب المفتوح

**R1 — medium — غير حاجب لعقد t2.** `tools/nasq_cli/cli.py:316-317` و`apps/control-plane/src/__tests__/adapter-boundary.test.ts:161`.

مسار `status` المستقرّ غير-`ok` في `managed_runtime.py:691-725` يعيد `(JOURNAL_EXIT[row['status']], payload)` بلا حقل `error`. الخريطة الموثّقة (`cli.py:32-34` و`managed_runtime.py:131-135`) تجعل `conflict` = 4 و`needs_intervention` = 6. بعد `print` الناجح لـJSON، السطر 317 يقرأ `payload["error"]["code"]` فيرمي `KeyError`. العملية تخرج 1 مع traceback، بينما JSON على stdout سليم (`operation=tenant.create`، `policy_verified=false`، digest مطابق).

الأثر: عقد رموز الخروج مكسور في مسار قراءة-فقط. الاختبار يثبّت `expect(status.code).toBe(1)` فيوثّق العَرَض. لا يُعاد تصنيف هذا كنجاح لرمز 4. لا خطر تنشيط: أي رمز ≠ 0 يبقى `receipt_unverified` (`worker.ts:240` و`:252`)، و`status` لا يكتب.

الإصلاح اللازم، خطوة واحدة، المالك شريحة adapter ثم captain عند الدمج: في `cli.py` لا تفترض `error` على كل خروج غير صفري — اطبع `payload.get('error', {}).get('code')` فقط إن وُجد، وأعد رمز المحوّل كما هو (4 أو 6). ثم بدّل تأكيد الحدّ إلى `toBe(4)` لهذه الحالة، وأضف حالة CLI لـ`needs_intervention` تتوقع 6. لا تُسكت الاستثناء بإبقاء 1.

خارج نطاق هذه المراجعة (`tools` و`apps` خارج `docs/verification/`)، لذلك لم يُنفَّذ.

## ما لا يُعاد فتحه

- A-1 مغلق في المصدر والاختبار. لا finding جديد عليه.
- C-1 مغلق بأدلة t4 الحية (G5 markerless ⇒ 409/`reconciliation_required`، وG6 عشرة متغيرات). نقل فرق `service.test.ts` إلى شريحة control مسألة دمج (t4 F2)، لا عيب في اختبار الحدّ.
- F3 في t4 (غياب worker→adapter end-to-end) ملاحظة تغطية، لا خرق لمعيار t2 الذي يطلب استدعاء الوحدة الحقيقية لا مرور العامل.
- RD-2 وRD-7 وRD-8 تبقى مفتوحة وتحجب المصالحة. لا تُختار هنا.

## الحدود التي لا تُدّعى

- هذا ليس قبول SaaS ولا G1–G5 ولا نشرًا ولا commit/merge/push.
- PG integration دليل scratch محلية أُنشئت وأُسقطت في t4، وليس دليل إنتاج.
- `test:commercial` بلا env ليس قبول قاعدة.
- تطابق digest هنا على إيصال `conflict` من `preflight_unavailable`، لا على create ناجح. الخوارزمية نفسها، لكن لم يُثبَت إيصال `ok` عبر هذا الحدّ لأن المسبار الافتراضي مغلق قبل أي أثر.

# عقد واجهة سجل/هوية العميل المقترح — أساس العزل المشترك

الحالة: **مقترح للتنفيذ، غير منفّذ** (proposal, not implemented). المصدر:
`d780862e468e027286374ecebb9643f1490cc9e6` على فرع `codex/shared-isolation`.
هذا العقد مستخرج من `apps/web/server/utils/tenantHostResolver.ts` و
`docs/superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md` (البند 2)،
ولا يدّعي أن أي مسار طلب يستدعيه اليوم.

## 1. هوية العميل الثابتة (immutable tenant identity)

حقول هوية لا تُشتق من الاسم المعروض ولا من مدخل المستخدم، وتبقى ثابتة عبر إعادة
التسمية وعمليات النسخ/الاستعادة:

| الحقل | النوع | القيود |
|---|---|---|
| `tenantId` | string | `^[a-z][a-z0-9_-]{0,62}$`، فريد في السجل، غير قابل لإعادة الاستخدام بعد التعطيل |
| `host` | string | hostname معياري صغير (canonical, lowercase, ASCII) عبر `canonicalHost` |
| `database` | string | `^[a-z][a-z0-9_]{0,62}$`، فريد، لا تغيير بعد الإنشاء |
| `filestore` | string | `^[a-z][a-z0-9_]{0,62}$`، فريد، مرتبط بـ`database` واحد |
| `enabled` | boolean | تعطيل فوري بلا حذف؛ الهدف المعطّل يُرفض قبل تحميل قاعدة |
| `registryRevision` | integer | يزيد عند كل تعديل سجل؛ يُحمّل مع أي job/receipt ويُرفض عند التقدّم |

قواعد سلامة السجل (كما في resolver الحالي): ازدواج أي من `host`/`tenantId`/
`database`/`filestore` ⇒ `tenant_registry_invalid`؛ سجل فارغ أو هدف معطّل أو host
غير مطابق ⇒ `tenant_host_unavailable`؛ فشل مغلق دائمًا ولا default DB.

## 2. عقد الدالة المرجعي (resolved tenant)

```ts
resolveTenantHost(host, targets: readonly TenantHostTarget[]):
  ResolvedTenantHost // { tenantId, database, filestore }
```

مستهلكو هذا العقد: `apps/web/server/**` (routing/SSR/login/API/content/WS) و
`apps/control-plane/src/**` (jobs/receipts). أي مستهلك يضيف إلى الـresolved
قيمة `registryRevision` المستخدمة عند الحل، لتُختم في الـjob والـreceipt.

## 3. حدود الثقة (trust boundary)

1. proxy يزيل ترويسات forwarding الواردة ويصدر ترويسة host موثوقة واحدة.
2. لا استنتاج DB من بادئة hostname أو `X-Odoo-Database` أو session cookie منفردًا.
3. تضارب Host/جلسة/DB ⇒ رفض دون محاولة قاعدة بديلة (fail-closed).
4. `dbfilter=%h` وحده غير كافٍ؛ Odoo وproxy/jobs يحتاجان فحصًا مستقلًا.
5. العزل يبقى database-per-tenant؛ لا `res.company` بديلًا عن العزل.

## 4. عقد التجهيز المرتبط بالمستأجر (contract only)

- job يحمل `tenantId` + `registryRevision` عند القيد، ويفشل مغلقًا إذا تغيّر
  الهدف أو فقد السجل قبل التنفيذ (لا تحويل هدف صامت).
- `idempotency key` واحد لكل محاولة إنشاء؛ إعادة الطلب نفسه تعيد النتيجة دون أثر.
- receipt durable يربط العملية بالهدف والمحتوى؛ لا إعلان `active` بلا دليل قراءة.
- مرشح مطلوب لكل عملية: `tenantId` + `database` + `filestore` + `registryRevision`
  متطابقة، ورفض أي mismatch.

## 5. فجوات يجب على التابعين سدّها (لا يُدّعى إغلاقها هنا)

- لا مسار طلب فعلي يستدعي `resolveTenantHost` اليوم (t2).
- لا `registryRevision` مُعرَّف في السجل أو الـjob/receipt بعد (t2 + t3).
- لا محرك DB provisioning حي ولا ربط مستهلكين حقيقيين (t3، ثم t5).
- لا إثبات عبور 90 زوجًا (t6) ولا مراجعة أمنية مستقلة (t7).
- لا موارد حية أو قواعد جديدة أُنشئت في t1.

## 6. حدود هذه المهمة

t1 حفظ ونسخ وفحص آمن فقط: لا commit/merge/push/deploy، لا لمس `odoo19` أو
upstream Odoo، لا تغيير runtime قائم، ولا حذف موارد.
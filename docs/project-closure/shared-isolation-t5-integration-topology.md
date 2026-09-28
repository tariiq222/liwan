# t5 integration topology — topology الفعلي المطلوب لاختيار Odoo للجلسة/DB وtrusted forwarded host

الحالة: **تحضير تصميم (read-only)**؛ لا تنفيذ حتى تكتمل t2/t3/t4. الملكية: `baseline`.

## 1. الوضع الحالي (خط الأساس d780862e)

- `deploy/odoo.conf`: `dbfilter = ^${DB_NAME}$`، `list_db = False`، **`proxy_mode = True`** —
  قاعدة واحدة لكل عميل؛ لا عزل مشترك.
- `deploy/docker-compose.yml`: Odoo و`web` (Nuxt) على شبكة داخلية `expose` فقط؛
  proxy (Caddy) هو المدخل. لا `NASQ_TENANCY_MODE` ولا `registry` ولا حارس.
- `deploy/Caddyfile`: يوزّع على `odoo:8069` و`odoo:8072` (WS) و`web:3000` مباشرة.
- `apps/web/nuxt.config.ts`: `runtimeConfig.odooUrl` و`odooDb` ثابتان لكل نشر.
- `apps/web/server/api/auth/login.post.ts`: يرسل `params.db = odooDb` ثابتًا إلى
  `/web/session/authenticate` ويعيد كوكي Odoo كما هو.
- `apps/web/server/routes/api/v1/[...path].ts`: `proxyRequest` شفاف إلى `odooUrl` الثابت.

## 2. لماذا لا يكفي الوضع الحالي للعزل المشترك

1. **`proxy_mode = True` غير صالح للمشترك**: يستدعي ProxyFix على `HTTP_X_FORWARDED_HOST`
   (`odoo/http.py:2835-2840`) فيصبح الهوست الخارجي مؤثرًا في اختيار القاعدة. مطلوب
   `proxy_mode = False` مع إرسال `Host` داخلي = `registry.database`.
2. **`session.db` يسبق أي شيء**: `_get_session_and_dbname` (http.py:1829) يقبل قاعدة
   الجلسة إذا طابقت `db_filter`، وقارنها مع `X-Odoo-Database` (1831-1834 → 403).
   لذا حماية المشترك تعتمد على **رفض/استبدال SID الخام قبل تمريره إلى Odoo**، لا على
   الترويسة وحدها.
3. **مخزن الجلسات غير مرتبط بمستأجر**: `FilesystemSessionStore` واحد
   (`http.py:2771-2775`)؛ جلسة صالحة صادرة لمستأجر تصلح للقراءة عبر مضيف آخر ما لم
   يُربط الـenvelope بمستأجر.
4. **monodb fallback**: بلا `session.db` ولا ترويسة، `db_list(force=True)`
   (http.py:1840) قد يعيد قاعدة واحدة فيصبح monodb — ممنوع في المشترك.
5. **`dbfilter` وحده لا يترجم host عشوائي**: `db_filter` (389-418) يستبدل `%h`/`%d` ثم
   `re.match`؛ يعمل فقط إذا كانت أسماء القواعد مشتقة من الهوست. لا يمنع `X-Odoo-Database`
   المطابق ولا `session.db` المطابق. لازم معه ربط registry.
6. **ingress مباشر**: `deploy/Caddyfile` الحالي يمرّر مباشرة إلى Odoo؛ مع مشترك، من
   يصل إلى Odoo دون المرور بالحارس يختار قاعدته بنفسه (عبر `X-Odoo-Database` أو جلسة).

## 3. Topology المطلوب (تصميم، لا تنفيذ)

- **طبقة ingress واحدة** (guard.mjs كما في عقد routing) تترجم Host الموثوق →
  `Host` داخلي = `registry.database`، ترفض/تستبدل `session_id` الخام بـenvelope موقّع
  مرتبط بالمستأجر + `registryRevision`، وتحذف ترويسات الاختيار/التمرير الواردة
  (`X-Odoo-Database`، `X-Forwarded-Host`، `Forwarded` من العميل).
- **لا وصول مباشر إلى Odoo/Nuxt من خارج الشبكة الخاصة**: لا منافذ منشورة لـOdoo/Nuxt،
  والحارس هو المصدر الوحيد. حماية شبكة + حماية بروتوكول معًا.
- **Odoo**: `dbfilter = ^%h$`، `list_db = False`، `proxy_mode = False`، بدون `--db-filter`
  بديل أو fallback monodb.
- **Nuxt (SSR/BFF)**: `NUXT_ODOO_URL` يشير إلى **الحارس** لا إلى Odoo مباشرة، ويحمل
  `X-Nasq-Proxy-Token` + Host خارجي + `X-Nasq-Tenant-Revision` من registry الجلسة.
  لا يستنتج DB من الكوكي ولا يمرّ `params.db` إلا عبر ترويسة الحارس الموثوقة.
- **WS**: نفس مسار الحارس (تحقق + تمرير) لا مسار مستقل إلى `odoo:8072`.

## 4. نقاط تكامل t5 (ملكي)

| # | الملف/الطبقة | المطلوب |
|---|---|---|
| 1 | `deploy/odoo.conf` | `proxy_mode=False`، `dbfilter=^%h$`، `list_db=False` |
| 2 | `deploy/docker-compose.yml` | حاوية guard، إزالة `expose` العام لـodoo/web عند المشترك، env `NASQ_TENANCY_MODE`، keyring |
| 3 | `deploy/Caddyfile` | توجيه كل HTTP+WS إلى الحارس، لا إلى Odoo مباشرة في shared mode |
| 4 | `apps/web/nuxt.config.ts` | `odooUrl` → عنوان الحارس؛ تمرير ترويسات المستأجر |
| 5 | `apps/web/server/api/auth/login.post.ts` | إرسال `X-Nasq-Proxy-Token` + Host؛ عدم تمرير `params.db` من العميل |
| 6 | `apps/web/server/api/auth/logout.post.ts` | تمرير واضح لمسح envelope الجلسة عبر الحارس |
| 7 | `apps/web/server/routes/api/v1/[...path].ts` | تمرير الترويسات الموثوقة + حفظ كوكي الحارس |
| 8 | `apps/web/server/api/auth/totp.post.ts` | MFA ضمن نفس قناة الحارس |

## 5. اعتماديات غير مكتملة

- عقد routing النهائي (`deploy/shared/**`): أسماء env/keyring، شكل envelope، واجهة
  الحارس، ومكان توليد cookie. **لم يصل بعد.**
- عقد t3 (provisioning) للحقول `tenantId/database/filestore/registryRevision` — مماثلة
  لما في `tenantHostResolver.ts` لكن بحقول job/receipt.
- لا أثبّت أن الحل مغلقًا: قرار captain أشار إلى أن مطلب "اختيار DB مقيد بالعميل
  الموثوق لكل طلب حتى مع stolen session" يبقى **مفتوحًا** حتى يُثبت عبر الحارس.
  monkey-patch مرفوض؛ فأي فجوة متبقية تُصعَّد كـremaining blocker.

## 6. مقياس الإثبات

- mock proof (الحارس + اختبارات) لا يُغلق 90 زوجًا حية.
- 90 live pairs تتطلب موارد فعلية باعتماد منفصل (t6)، ولا `odoo19`.

## 7. ملاحظات لا تُنفّذ الآن

- لا monkey-patch على `odoo/http.py` أو أي ملف upstream.
- لا patch Odoo ولا تعديل `proxy_mode` في `odoo.conf` قبل اعتماد العقد.
- لا لمس `odoo19` أو runtime قائم.

## 8. عقد t3 المؤكد (provisioning) — التزامات t5

أكّد provisioning أربع نقاط في المحاولة b2f2ce69؛ صارت قيودًا على t5:

1. **الاستيراد**: مسار `apps/control-plane/src/shared/provisioning.ts` النسبي
   `'../../../../packages/commercial-contracts/src/shared/provisioning.js'` مؤقت مقصود
   ليبقى executable قبل t5. **t5 يتولى**: تبديله إلى `@nasq/commercial-contracts/shared`
   مع subpath export في `packages/commercial-contracts/package.json`. لا barrel إضافي.
2. **business_key عمود مستقل**: UNIQUE `(tenant_id, business_key)`، singleton لعمر tenant
   لمهمة provision. `request_id` transport/audit فقط ولا يُستخدم للحماية.
   **t5 يتولى**: إضافة العمود والفهرس في schema reconciliation، مع إبقاء الفهرس الحالي
   `UNIQUE (actor_uid, issuer, tenant_id, request_id)` (schema.sql:56) كما هو.
3. **قيود الهوية**: UNIQUE على `(tenant_id, database, filestore)` مع tombstones لمنع
   إعادة استخدام الأسماء. **t5 يتولى**: إضافتها في schema reconciliation؛ لا يكفي fencing.
4. **freeze**: مقصود على cloned parsed value؛ Zod parse يعيد clone في كل مرة، فلا تعديل
   للأصل ولا تعارض عند الربط. لا تغيير في t5.

**تنسيق مع routing**: `registryRevision` موجب per-tenant، و`snapshotRevision` منفصل
(global). متسق مع `TenantBinding.registryRevision` في t3 ومع `ResolvedTenantHost` في
`tenantHostResolver.ts`.

**integration README من provisioning** سيحدد CAS `started` قبل effect، fencing/lock،
وحدود pure planner. **t5 يلتزم بها** عند ربط `reconcileSharedJob` بـworker/HTTP.

## 9. عقد routing النهائي (t2) — التزامات t5 وأسئلة مفتوحة

**الحارس** (`deploy/shared/guard.mjs`): `createGuard({registryPath, proxyToken, keys,
activeKid, odooUrl, webUrl, wsUrl})`.

**env الرسمية:**

| env | المستهلك | ملاحظة |
|---|---|---|
| `NASQ_SESSION_KEYS` | الحارس | JSON object kid→secret، ≥32 بايت |
| `NASQ_SESSION_ACTIVE_KID` | الحارس | kid النشط |
| `NASQ_GUARD_ODOO_URL` / `NASQ_GUARD_WEB_URL` / `NASQ_GUARD_WS_URL` | الحارس | أهداف داخلية |
| `NASQ_GUARD_PORT` | الحارس | منفذ الاستماع |
| `NUXT_ODOO_URL=http://guard:8080` | Nuxt | SSR وauth معًا |
| `NASQ_TENANT_REGISTRY_PATH` | الحارس (+Nuxt؟) | سجل JSON |
| `NASQ_SHARED_PROXY_TOKEN` | الحارس+Nuxt | hop خاص |
| `NASQ_TENANCY_MODE=shared` | الكل | `shared`/`dedicated` |

**سلوك الحارس:**
- `Host = registry.database` **فقط**؛ لا `X-Odoo-Database` يُرسَل.
- يحذف ترويسات forwarding الواردة.
- `proxy_mode=False` في Odoo.
- كوكي `session_id`: `base64url(JSON [1,kid,tenantId,registryRevision,exp,sid])` + HMAC_SHA256؛
  tenant-bound، `Secure; HttpOnly; SameSite=Lax; host-only`. **ليست سرية**.
- WS: إغلاق قسري ≤30s وإعادة فحص.
- يبصم hop خاص web token+revision؛ middleware Nuxt يتحقق ويعيد الحل.

**أجوبة routing النهائية (كل الأسئلة الستة محسومة):**

1. **كوكي `session_id`**: نعم **نفس الاسم**، يستبدل الخام. BFF يمرره إلى الحارس فقط
   (لا إلى Odoo مباشرة)، ويعيد `Set-Cookie` من الحارس حرفيًا.
2. **`NASQ_SHARED_PROXY_TOKEN` ثنائي** (guard↔BFF). لكن **edge MUST reject كل ترويسة
   `x-nasq-*` واردة** قبل الحارس. مستمع الحارس داخلي/خاص، وBFF خاص.
3. **Nuxt يقرأ `NASQ_TENANT_REGISTRY_PATH` read-only fresh** بنفسه ويعيد حل المستأجر؛
   لا يثق بترويسة الحارس وحدها.
4. **احذف `routeRules` كاملة في `shared`**. الحارس يسمح `/web/content` فقط ويرفض
   `console/database/RPC`، ولا raw Odoo login. (لا إعادة توجيه — حذف.)
5. **WS على نفس منفذ الحارس**. `wsUrl=''` في المتصفح (same-origin edge→guard)؛
   **لا WS من Nuxt**.
6. **Nuxt لا يحتاج مفاتيح HMAC**؛ فقط `NASQ_SHARED_PROXY_TOKEN` + `NASQ_TENANT_REGISTRY_PATH`.

**قرار الملكية النهائي من captain (يحسم الخلاف):**

- `apps/web/server/**` و`deploy/shared/**` **ملك routing حصريًا في t2**.
- إرشادات captain عن SSR/login كانت **مسؤولية تحقق تكامل**، لا تصريح كتابة متزامنة.
- **t5 يملك نقاط التكامل المشتركة بعد t2** كما في الخطة؛ أي إصلاح في `server` **بعد
  freeze ينسق بتسليم صريح** من routing.

**نطاق t5 المعتمد (يملكه baseline) — مطابق لوصف t5 المحدَّث في team.json:**
1. `apps/web/nuxt.config.ts`
2. `deploy/Caddyfile`
3. `deploy/docker-compose.yml`
4. `deploy/odoo.conf`
5. `packages/commercial-contracts/package.json` (exports)
6. `packages/commercial-contracts/src/index.ts` (barrel export)
7. `apps/control-plane/src/http.ts` و`worker.ts` (**مبقاة في t5** — schema وحده لا يربط
   queue/execution ولا يحقق fencing)
8. `apps/control-plane/src/schema.sql`

**إضافة مهمة في وصف t5 المحدَّث**: تعديل imports ملفات t3 (`apps/control-plane/src/shared/**`)
بعد freeze وتسليم صريح من provisioning — أي أن t5 يعيد ربط الاستيراد النسبي المؤقت إلى
subpath `@nasq/commercial-contracts/shared`.

**قيود إلزامية أضافها captain على t5 (كلها ملزمة):**

1. **لا اعتماد للقيم المقترحة قبل فحص topology** ودعم syntax/runtime لكل تعديل.
2. **ممنوع تغيير dedicated defaults**: shared opt-in عبر تكوين منفصل/override محكم.
3. **لا حذف `routeRules` كاملة عشوائيًا**: احصر قواعد proxy المتعارضة فقط، واحفظ
   security/cache وما عداها.
4. **لا يكفي Compose override لإزالة ports الموروثة** إلا بإثبات rendered config.
5. **`proxy_mode=False` قرار محتمل لا معتمد تلقائيًا**: أثبت host canonical وTLS/Secure
   cookie وredirect/origin/WS خلف reverse proxy قبل تبنّيه.
6. **`http.ts`/`worker.ts` داخل نطاق t5**؛ schema وحده لا يحقق الربط.
7. **تغييرات import داخل ملفات t3 بعد freeze** تمر بتسليم صريح.
8. **Node24 strip-types**: يجب إثبات **تشغيل صورة guard واستيراداتها فعليًا**، لا مجرد
   `tsc`. لكن **لا تشغيل Docker/موارد جديدة دون نطاق معتمد**.
9. captain سيحدّث وصف t5 رسميًا لإزالة الالتباس.

**تنبيه توافق مهم من routing**: الحارس (TS source) يستورد utils عبر
**Node24 strip-types** لذلك الصورة تحتفظ بـ`utils` tree كاملًا. **يجب على t5 التحقق** من
أن صورة الحارس تحتفظ بـ`apps/web/server/utils/**` (أو أي مسار يستورده الحارس) وأن
`strip-types` مُفعّل عند التشغيل.

**اختبار مطلوب من t5**: SSR يجب أن **يحتفظ** بـ`Host` وtoken على internal subrequests —
أُضيف إلى قائمة تحقق t5.

## 10. توجيهات captain الإضافية على t5 (ملزمة)

### 10.1 الربط الجديد يبقى dormant/fail-closed
بناءً على `t3 INTEGRATION.md`: إضافة schemas/planner **لا تعني** أن shared provisioning جاهز.
في t5:
- الربط بـ`reconcileSharedJob` **يبقى dormant** إن لم يكن هناك adapter وdurable store مثبتان.
- **fail-closed** عند غياب أي منهما؛ لا إعلان جاهزية.
- **لا provision حي** ضمن t5.
- إن تعذّر الربط الكامل، **t5 يصرّح بدقة بما بقي غير مربوط** بدل ادعاء الإغلاق.
- المطلوب إن أمكن الربط الحقيقي: الهوية، تفويض enqueue+execute، `business_key` unique،
  وdurable fenced semantics. أي بند لا يكتمل يُدرج في handoff صريح.

### 10.2 عائق day-2: exact revision في backup/restore
السلوك الحالي في عقد t3 يرفض النسخ/الاستعادة بعد تغيير `host` أو `enabled`.
- هذا **قيد آمن** وليس ميزة جاهزية.
- **t5 يوثّقه ولا يفكّ الـmatching سرًا.**
- مسار استعادة مصرّح يعيد التحقق من **resource identity منفصلًا عن routing revision**
  يحتاج عقدًا لاحقًا (ليس في t5).

### 10.3 التزام handoff
يُضاف إلى handoff t5: **ربط frontend/session changes بالتبعية t2 قبل العمل**.
أي عمل على Nuxt session/SSR في t5 لا يبدأ قبل أن يكون عقد t2 النهائي مثبتًا ومُسلَّمًا.

## 11. قيد `filestore == database` (ملاحظة تسليم من t3 — تحتاج regression)

**المصدر:** provisioning، ملاحظة تسليم على t3 المكتمل (attempt b2f2ce69).

**الحقيقة في Odoo 19 (مؤكدة بقراءة `/Users/tariq/code/odoo`):**
`odoo/tools/config.py:1031-1032`:
```python
def filestore(self, dbname):
    return os.path.join(self['data_dir'], 'filestore', dbname)
```
أي أن مسار filestore مشتق حصريًا من `data_dir/filestore/<dbname>` — لا يمكن أن يختلف
اسم filestore عن اسم القاعدة عند استخدام Odoo stock. نفس النمط في `service/db.py:207-208`
و`250` و`291` (dump/duplicate/restore).

**الأثر على العقد الحالي (t3، مغلق):**
- `tenantBindingSchema` يبقي حقلين مستقلين `database` و`filestore`.
- اختبارات t3 الاصطناعية تستخدم `db_a`/`fs_a` (مختلفان) وهذا لا يحاكي Odoo الحقيقي.
- إذا مُرِّر binding بـ`database != filestore` إلى Odoo حقيقي، فسيُقرأ/يُكتب filestore تحت
  `data_dir/filestore/<dbname>` رغم أن العقد يقول غير ذلك — أي انزلاق بين الاثنين.

**المطلوب في t5 (أحد الخيارين، أحدهما إلزامي):**
1. **فرض `database === filestore` كشرط execution في مسار shared** قبل queue/effect —
   فحص في `http.ts`/`worker.ts` أو في مسار enqueue، مع **regression اختبار mismatch**
   يفشل مغلقًا (`tenant_binding_mismatch` أو رمز مماثل).
2. **أو** إضافة refinement في العقد نفسه (`tenantBindingSchema.refine(db===fs)`) — يحتاج
   إعادة فتح t3 أو تسليم صريح من provisioning (t3 مغلق الآن).

**قرار الحل المقترح:** الخيار (1) داخل نطاق t5؛ لا يحتاج إعادة فتح t3. لكن يجب تسجيل أن
العقد العام يظل يسمح بقيم مختلفة، وأن ضمان shared lane يأتي من فحص t5 لا من Zod. أي
consumer مستقبلي يستورد العقد مباشرة (بدون مرور t5) لن يحصل على هذا الضمان.

**يُسجَّل الآن كتحقق مطلوب لـt5، ولا يُنفّذ حتى تكتمل t2.**
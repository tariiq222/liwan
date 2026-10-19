# OCA DMS Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if the owner selects delegation. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** إحلال مستندات HR الحالية بتطبيق مستندات مستقل يستخدم OCA DMS، مع حفظ البيانات والروابط ووظائف النص والمرفقات، وفرض صلاحيات ويب فيو على جميع مداخل المحتوى.

**Architecture:** `webvue_documents` تطبيق rank 4 يملك سجل الأعمال `webvue.document` ومنح الوصول، ويستخدم DMS للملفات والمجلدات وAttachment storage. يرث DMS الوصول من سجل المستند بدل إنشاء قائمة مستخدمين موازية في مجموعاته. `webvue_documents_hr` جسر rank 5 يملك علاقة القسم والتقارير؛ HR والمستندات مستقلان ولا يستورد أحدهما التطبيق الآخر.

**Tech Stack:** Odoo 19 Community، OCA DMS `19.0.1.1.3`، PostgreSQL، Nuxt 4/Vue، TanStack Query، Zod، Nuxt UI وStorybook.

**Spec:** [تقرير الفحص والمقارنة](../../research/2026-10-19-oca-dms-assessment.md)، وتفصيل العقود والقرارات التخطيطية أدناه. التقرير دليل بحث؛ AGENTS.md وDESIGN.md وقواعد الطبقة تتقدم عليه.

**Status:** اعتمد المالك التنفيذ في 2026-10-19 داخل `docs-oca-dms` مع الاختبارات والصلاحيات، دون commit أو merge. اكتمل التنفيذ والقبول المحلي؛ لا تفويض push أو نشر أو ترحيل قاعدة فعلية. انظر docs/verification/oca-dms/acceptance.md لحواجز baseline وحدود التحقق.

## Global Constraints

- نسخة التخطيط: WebVue `dc39a8eb734da4557d341fbe24b2fc63d773fbb1`، والتري `/Users/tariq/code/webvue/.worktrees/docs-oca-dms`، والفرع `codex/docs-oca-dms`. قارن مع main الحالي قبل التنفيذ واحفظ أي تغييرات أخرى؛ لا تدمج main في هذا التري دون تفويض الدمج.
- مصدر OCA المثبت المقترح: `OCA/dms`، branch `19.0`، commit `42aec9613f64402ec702e8e21cfb643626a41056`. يبقى خارجيًا في آلية `deploy/oca-addons.json`، ولا يُنسخ إلى `odoo-addons/` ولا يُعدّل.
- بيئة محلية معزولة فقط: قاعدة `webvue_scratch_*` جديدة لكل تشغيل، config وdata_dir وlogfile ومنافذ منفصلة. لا اختبارات على `odoo19`، ولا قراءة بيانات فعلية ضمن تنفيذ الخطة دون تفويض مناسب.
- القوائم `{items,total}`، وJSON routes بـ`type='json2'`, `auth='user'`, explicit methods, `api_handler`. تنزيل البايتات HTTP مع التحقق نفسه. لا bearer token للمتصفح.
- حجم الملف الجديد `10 * 1024 * 1024` بايت؛ حد النقل الحالي `16 MiB` للطلب و`32 MiB` للاستجابة، ولا ترفع الحدود ضمن هذا الإحلال.
- quota التخزين الحالية في `webvue_platform/models/ir_attachment.py` تقيس bytes عند create/write؛ أعد استخدامها عبر ir.attachment ولا تنفذ claim إضافيًا في DMS adapter. dms.file الذي يشير للمرفق نفسه لا يضاعف الاستعمال، والأرشفة لا تفرغ مساحة القرص.
- Arabic/RTL أولًا، EN، الثيمان، شاشات 390/768/1440، direct link/refresh/back/filter/draft. تتبع الصفحات وSharedCreatePanel وStorybook وفق DESIGN.md.
- مصدر حقيقة واحد لكل محتوى ومنحة وصول. لا جدول HR قديم موازٍ، ولا API قديم للكتابة، ولا تكرار بايتات المرفقات، ولا بقايا schema أو suppressions جديدة لتجاوز الفحوص.
- لا sudo جديد في adapter. تشغيل migrations وmodule data كـsuperuser عملية ترقية موثوقة. استخدامات sudo الداخلية في المصدر الخارجي تُسجل كواقع vendor؛ لا تُنسخ إلى إضافاتنا ولا يُوسع نطاقها.
- يعمل التطبيق في saas وnon_saas دون control plane في مسار التشغيل. new feature keys مغلقة افتراضيًا في catalog/policies؛ تُحمل صلاحية تشغيل المستندات القديمة إلى الجديدة صراحة أثناء ترقية tenant المخوّل.
- نموذج الوكلاء `gpt-6.1-sol` فقط. التنفيذ المقترح inline، effort high للهوية والترحيل والوصول، medium للواجهة والعقود المحددة. لا وكيلان يكتبان الملفات نفسها، ولا worktree/node_modules/.nuxt مشتركة بين كتاب مستقلين.
- اقرأ `odoo-workflow` ثم `odoo-19` قبل أي كود Odoo، وشغّل trace حقيقي للحقول/hooks. اقرأ integration-rules عند طلب الدمج لاحقًا. لا تعتمد على تواريخ تقارير الاختبار كدليل جديد.

## Review Focus

1. تنزيل attachment بعد سحب capability أو grant أو أرشفة الملف: يجب أن يفشل عبر API و`/web/content` والـbinary fields ومسارات OCA/RPC؛ يثبته Task 3 وTask 7.
2. حفظ متزامن مع تغيير دور/وصول/مرفق: لا يعمل تحقق قديم بعد انتظار القفل، ولا يكتب حفظ قديم فوق جديد؛ يثبته Task 2 وTask 4.
3. attachment قديم مشترك أو اسمان متكرران أو رابط قائم: لا حذف ولا نسخ بايتات ولا تغيير اسم صامت؛ يثبته Task 5.
4. مسودة نص مفتوحة ثم رفع/أرشفة ملف أو رجوع سريع: تبقى المسودة ويظهر تعارض مفهوم، ولا يوحي إلغاء النص بإلغاء عملية ملف حُفظت؛ يثبته Task 6.
5. اختلاف ترتيب تثبيت الإضافات/ترقيتها وإعادة migration بعد تعثر: لا يمحو تنظيف metadata جدول المستند أو المرفقات ولا يكررها؛ يثبته Task 1 وTask 5.

---

## 1. النطاق والسلوك الذي تنفذه هذه الخطة

يشمل الإحلال العنوان وHTML وتاريخ الانتهاء، الإنشاء والتعديل، البحث والفلترة والترقيم، المرفقات وتنزيلها، أرشفة/استعادة المستند والملف، القفل المتاح في DMS، وربط القسم وتقارير الانتهاء. يضاف نطاق رؤية صريح `company | restricted` وتفويض قراءة/تحرير للأشخاص الداخليين.

الجديد افتراضيًا `restricted` مع منحة editor للمنشئ. السجلات الحالية تهاجر `company` لأنها كانت مقروءة لكل أصحاب `hr.documents.read` في الشركة؛ لا نحولها تلقائيًا إلى سرية ولا نفقد وصولًا معتمدًا. المعنى الظاهر للمستخدم هو «متاح لأصحاب صلاحية المستندات في الشركة»، وليس «عام على الإنترنت».

لا تشمل هذه الدفعة سجل إصدارات قابل للاستعادة أو OCR أو توقيعًا أو دورة اعتماد أو مشاركة عامة أو حذفًا نهائيًا من واجهة العميل؛ هي قدرات غير موجودة في الأساس المفحوص. لا تُعرض أزرار توحي بتوفرها. الأرشفة ليست إصدارًا سابقًا، والقفل ليس حسمًا لتعارض الحفظ.

استخدام DMS في الدفعة: storage مُدار لكل شركة، root بنيوي، ومجلد لكل سجل مستند؛ تصنيف عبر القسم والوسوم. لا نضيف محرر شجرة مجلدات حرة أو نجعل المستخدم يدير storage ومجموعات OCA. هذا يحفظ نموذج المستند متعدد المرفقات ويمنع سجل صلاحيات موازٍ. تثبت Task 1 الملاءمة قبل البناء.

الواجهة الأساسية `/documents`، `/documents/new`، `/documents/:documentId` و`/documents/:documentId/edit`. تحفظ الروابط القديمة بتحويل تنقل فقط إلى الصفحة الجديدة، لا adapter API قديم ولا نسخة ثانية من منطق المستندات. صفحة القسم تعرض مدخل «مستندات القسم» إلى المكتبة المصفاة بدل تضمين مكوّن من تطبيق آخر؛ هذا تغيير تنقل مقصود في الخطة ويُختبر صراحة.

## 2. عقد البيانات والملكية

| الموديل | الحقائق التي يملكها | قيود أساسية |
|---|---|---|
| `webvue.document` | `name`, sanitized `body`, `expiry_date`, `active`, `company_id`, `visibility`, integer `revision`, `directory_id` | company إلزامية وتثبت عند الإنشاء؛ revision يبدأ 1؛ directory فريد؛ لا اسم الملف أو بايتاته هنا |
| `webvue.document.grant` | `document_id`, internal `user_id`, `access=reader|editor` | unique(document,user)، شركة مستمدة من المستند؛ editor يتضمن القراءة ولا نكرر صف reader |
| `dms.directory` | المجلد البنيوي للمستند والـroot والربط بـ`res_model/res_id` | storage خاص بالشركة، leaf مرتبط بمستند واحد، لا نقل عبر الشركات ولا res_model حر |
| `dms.file` | اسم الملف ونوعه وحجمه وحالته وقفل تحريره و`attachment_id` | كل ملف في نطاق التطبيق مرتبط بمستند معلوم من مجلده؛ لا shadow attachment list على المستند |
| `ir.attachment` | البايتات المخزنة | res_model=`webvue.document`, res_id صحيح، public=False، لا اعتماد على access_token للوصول |
| امتدادات `dms.tag/category/access.group` | company_id ونطاق metadata | company إلزامية وparent/category من الشركة نفسها؛ لا memberships موارد موازية لمنح المستند |
| امتداد الجسر على `webvue.document` | `department_id` اختياري للشركة الحالية | ondelete=restrict؛ لا hr model/field داخل الإضافة الأساسية |

`directory_id` محمي من كتابة العميل. إنشاء السجل ومنحة المنشئ ومجلده عملية واحدة قبل رجوع create؛ لا commit وسيط ولا سجل قابل للاستخدام بلا directory. يسمح تنفيذ create بمرحلة داخلية داخل transaction واحدة قبل إكمال العلاقة، ثم يتحقق invariant قبل return؛ تختبر Task 1 مسار OCA الذي يتطلب السجل أولًا. الاسم البنيوي للمجلد `document-<id>`، والعنوان التجاري في `webvue.document.name` فقط.

يوجد source واحد للملفات: One2many/بحث مشتق من `directory_id` إلى dms.file. لا Many2many جديدة إلى attachment ولا قائمة ملفات مخزنة في JSON. روابط HR عبر الجسر، وليست حقولًا اختيارية تسحب HR إلى core.

`webvue.document.links` سجل نقاط امتداد داخل التطبيق، وليس خدمة foundation جديدة:

- `_webvue_context_definitions() -> tuple[dict,...]`؛ الافتراضي فارغ.
- `_webvue_context_options(kind: str, q: str|None, limit: int, offset: int) -> dict`؛ يرفض النوع غير المسجل.
- `_webvue_prepare_context(context: dict|None) -> dict`؛ يرجع fields موثوقة يملكها الجسر أو 422.
- `_webvue_dump_context(document) -> dict|None`؛ لا يستنتج اسم قسم أو رابطًا لا يملك المستخدم قراءته.
- الجسر يسجل فقط kind=`hr.department`. اختيار/تغيير القسم يتطلب `hr.departments.read` مع إدارة المستند وميزات التطبيقين؛ إنشاء مستند مستقل لا يتطلب قراءة HR.
- قارئ مستند لا يملك قراءة القسم يستمر في قراءة المحتوى المسموح؛ context metadata تحمل ID مرتبطًا بالمستند مع `label=null, href=null` عند تعذر عرض تفاصيل القسم. لا SQL عرضي لتجاوز ACL القسم.

## 3. مصفوفة الصلاحيات الملزمة

قرار الوصول: مستخدم داخلي نشط + حالة tenant/feature + الشركة الحالية + capability + grant/visibility للسجل + حالة الأرشفة. للقراءة نستخدم قرارًا لحظيًا؛ للكتابة يعاد القرار بعد القفل. لا يمنح الانتماء لقسم أو لقب manager وصولًا ضمنيًا.

| القدرة | تمنح | تعتمد على | ما لا تمنحه |
|---|---|---|---|
| `documents.items.read` | قراءة المستندات المسموحة وملفاتها | — | لا قراءة المقيد بلا grant، ولا محتوى شركة أخرى |
| `documents.items.manage` | إنشاء المستند والتحرير ورفع الملفات وقفلها ضمن نطاق الكتابة | read | لا إدارة وصول الآخرين، ولا الأرشفة أو purge |
| `documents.items.archive` | أرشفة/استعادة السجل أو ملفه في نطاق الكتابة | manage | لا حذف بايتات أو سجل نهائيًا |
| `documents.access.manage` | تغيير visibility ومنح/سحب الوصول على سجل قابل لتحريره | manage | لا فتح مستند مقيد غير ممنوح للمستخدم |
| `documents.library.manage` | تهيئة storage/الفهرس والوسوم المُدارة في الشركة | read | لا تجاوز grant المقيد أو منح محتوى الأعمال للنفس |

`company`: read للقدرة read، وwrite للقدرة manage. `restricted`: read لمنحة reader/editor مع read، وwrite لمنحة editor مع manage. capabilities وحدها لا تتجاوز grant. يظهر all allowed actions في serializer من نفس القرار، ولا يعاد بناؤه من اسم الدور في Nuxt.

المنشئ يحصل editor تلقائيًا عند create، ولو لم يملك access.manage؛ لا يستطيع استغلال هذه الحالة لتعديل grants لاحقًا. تعديل الوصول مع access.manage يبقي على الأقل محررًا داخليًا نشطًا قادرًا على إدارة السجل؛ يُرفض إزالة آخر محرر أو إزالة قدرة actor نفسه بطريقة تترك المستند يتيمًا. يعاد التحقق من المستخدمين عبر `webvue.directory`، لا HR employee IDs. حساب معطل أو شركة أخرى أو portal يرفض 422/403 قبل الكتابة.

الأرشيف: لا يظهر في القوائم العادية. عرضه/تنزيله/استعادته يحتاج archive مع read/grant الملائم. أرشفة المستند لا تعيد كتابة active لكل ملف؛ الملف المؤرشف سابقًا لا يعود نتيجة استعادة المستند. لا DELETE نهائي للعميل، وunlink للموارد المُدارة مرفوض للمستخدمين حتى عبر RPC.

إدارة المكتبة لا تنشئ مسارًا لاسترجاع المحتوى السري. مشكلة انعدام أي محرر لاحقًا بسبب تعطيل الحسابات تعالج بعملية استرداد مشغّل موثوقة خارج واجهة العميل، ولا بتجاوز دائم لـsystem_admin.

| الدور/المنح الحالية | الترحيل/الافتراضي |
|---|---|
| employee صاحب hr.documents.read | documents.items.read؛ يرى company القديمة فقط والمقيد الممنوح له |
| hr_manager صاحب hr.documents.manage | read+manage فقط؛ لا نمنحه archive/access/library الجديدة تلقائيًا |
| دور مخصص | استبدال مفاتيح read/manage فقط، والحفاظ على assignments والشركات وIDs وإبطال cache |
| system_admin | لا إضافة تلقائية لأي documents capability أو grants |
| documents_manager جديد | read/manage/archive/access/library؛ لا assignment تلقائي لأي مستخدم |
| vendor support | يتبع السياسة الحالية لدعم العميل وحالة support_access_enabled، ولا يوسع وصوله عبر مسار DMS جانبي |

لا قدرات منفصلة لقراءة attachment والنص في هذه الدفعة؛ كلاهما جزء من سجل واحد. `dms.group_dms_user` projection تقني عبر capability group عند الحاجة، مع model guards للشركة والقدرة. لا grant runtime لـ`dms.group_dms_manager` أو base.group_system. storage يضبط `inherit_access_from_parent_record=True` وmodel_ids allowlist=`webvue.document` فقط؛ لا DMS access-group memberships ثانية لمستخدمي المستند.

## 4. العقود التي تتشاركها المراحل

### Domain methods

في `models/document.py`:

- `_webvue_can(operation: 'read'|'write'|'archive'|'access') -> bool` و`_webvue_require(operation) -> None`، دائمًا باستخدام الهوية الحالية.
- `_webvue_create_document(values: dict, context: dict|None=None) -> record`؛ يرفض company_id/directory_id/revision/grants في القيم العامة.
- `_webvue_mutation(expected_revision: int, operation: str)` context manager: قفل سياسة الشركة عبر `_webvue_lock_company` الحالي ثم قفل صف المستند، invalidate وإعادة capability/visibility/active/revision. 409 code=`conflict` وdetails.current_revision عند عدم التطابق. لا قفل اعتماد على token صادر من العميل.
- `_webvue_update_document(patch: dict, expected_revision: int) -> record`.
- `_webvue_set_access(visibility: str, grants: list[dict], expected_revision: int) -> record`؛ يستبدل المجموعة atomically بعد التحقق ويحذف الصفوف الملغاة دون ترك نسخ.
- `_webvue_set_active(active: bool, expected_revision: int) -> record`.

في `models/document_file.py`:

- `_webvue_upload(document, upload: dict, expected_revision: int) -> record`؛ يأخذ ناتج validator المشترك.
- `_webvue_set_file_active(document, file_id: int, active: bool, expected_revision: int) -> record`.
- `_webvue_set_file_lock(document, file_id: int, locked: bool, expected_revision: int) -> record`؛ القفل لصاحبه، وmanage ليس force-unlock عامًا.

كل mutation ناجحة ترفع revision المستند **مرة واحدة**، وتشمل ملفًا أو grant أو active؛ لا يعاد استخدام write_date كتوكّن إصدار. فحص parsing/حجم الملف يتم قبل الأقفال، والكتابة وتحديث revision في transaction واحدة. ترتيب الأقفال policy(company) ثم document ثم file/grant IDs تصاعديًا، وتختبر إزالة grant وتغيير الدور مع طلبات معلقة. استخدام SQL إن احتاجه قفل الصف محصور بقفل جدولنا الخاص في helper موثق؛ لا SQL على جداول أعمال Odoo الأصلية ولا نسخ private framework methods.

### Wire contract

- `DocumentSummary = {id,name,visibility,active,expiry_date,write_date,revision,file_count,tags,context,allowed_actions}`، بلا HTML أو bytes في القائمة. `tags:[{id,name}]` إسقاط من directory.tag_ids، وليس Many2many ثانية على المستند.
- `DocumentDetail = Summary + {body,files}`. file_count يحسب الملفات النشطة المرئية؛ files تضم النشطة، وتضم المؤرشفة أيضًا فقط لمن يملك archive على السجل لتتوفر له الاستعادة. التعديل ورفع ملف جديد يتطلبان مستندًا نشطًا؛ restore عملية مستقلة، وإدارة وصول مستند مؤرشف تحتاج archive بالإضافة إلى access.manage.
- `DocumentFile = {id,name,mimetype,file_size,active,is_locked,is_lock_editor,download_url,allowed_actions:{archive,restore,lock,unlock}}`؛ id هو dms.file ID، وflags من قرار الخادم، ولا تكشف storage/path/attachment token. URL=`/api/v1/documents/{documentId}/files/{fileId}/download`.
- `DocumentContext = {kind:string,id:number,label:string|null,href:string|null}|null`، النوع معروف في registry الخادمي، ولا model name passthrough حر.
- `DocumentAccess = {visibility,grants:[{user:{id,name},access:'reader'|'editor'}],revision}`؛ لا يُعاد إلا لمن يملك access.manage على السجل. مالك editor بلا access.manage يحصل فقط allowed_actions.
- `allowed_actions={update,archive,restore,upload_file,manage_access}` مفاتيح boolean. التفاصيل المقروءة لا تكشف كل الأشخاص المخولين تلقائيًا.
- Zod strict لكل write shape؛ PATCH `{expected_revision, name?,body?,expiry_date?,context?,tag_ids?}` مع حقل تغيير واحد على الأقل. tag_ids فريدة وموجودة في الشركة الحالية، وتكتب directory.tag_ids من نفس mutation/revision. `visibility` وgrants فقط في access API. missing/invalid revision=422، stale revision=409.

| API | الطلب/النتيجة |
|---|---|
| GET `/api/v1/documents` | q,context_kind,context_id,archived,limit<=200,offset؛ بحث عنوان، نتيجة Summary list |
| GET `/api/v1/documents/{id}` | 200 Detail |
| POST `/api/v1/documents` | create `{name,body?,expiry_date?,context?,tag_ids?}` يرجع 201 Detail restricted |
| PATCH `/api/v1/documents/{id}` | عقد patch أعلاه؛ 200 Detail |
| POST `/{id}/archive` أو `/restore` | `{expected_revision}`؛ 200 Detail |
| GET/PUT `/{id}/access` | GET Access؛ PUT `{expected_revision,visibility,grants}`؛ 200 Access |
| POST `/{id}/files` | `{expected_revision,name,data,mimetype?}`؛ data base64؛ 200 Detail |
| POST `/{id}/files/{fileId}/archive|restore|lock|unlock` | `{expected_revision}`؛ 200 Detail |
| GET `/{id}/files/{fileId}/download` | session read/grant/archive gate ثم attachment streaming؛ بلا token عام |
| GET `/api/v1/documents/contexts` | أنواع السياق المتاحة للمستخدم من registry؛ بلا بيانات قسم محجوبة |
| GET `/api/v1/documents/contexts/{kind}/options` | q,limit,offset؛ items/total، feature/capabilities الخاصة بالprovider |
| GET/POST `/api/v1/documents/tags` | GET q/limit/offset للأوسمة في الشركة مع read، POST `{name}` مع library.manage؛ Tag=`{id,name}`، لا model/category/company_id من العميل |

كل `/{id}` أعلاه تحت `/api/v1/documents`. document غير منظور أو file لا ينتمي له=404؛ افتقاد capability للعملية=403؛ input=422؛ conflict=409. التنزيل لا يعيد HTML login ولا redirect خارجي، ويضبط Content-Disposition وnosniff و`Cache-Control: private, no-store` ولا يكشف paths. هذه السياسة تشمل الاستجابة للملف المُدار عبر المسار الأصلي أيضًا؛ `unique` أو token لا يحولانه إلى محتوى عام قابل للتخزين. سحب الإذن يمنع طلبات جديدة ولا يمحو نسخًا سبق تنزيلها.

## 5. خريطة الملفات وتسلسل الملكية

| الحزمة | الملفات والمسؤولية | التبعية |
|---|---|---|
| T1 محرك وتجربة إحلال | pins/provenance وscratch harness | البداية |
| T2 سجل وصلاحيات | models/document,document_grant,access_service,feature_registry,directory,document_links؛ security/data | بعد T1 |
| T3 محرك محمي | models/dms_*,ir_attachment,document_file؛ controllers منع OCA | بعد T2 |
| T4 API والعقود | controllers/serializers وpackages/contracts/src/documents | بعد T3 |
| T5 جسر وترحيل | webvue_documents_hr، migrations HR/new app، hooks HR، أدوار وسياسات | بعد T4 |
| T6 واجهة وتنقل | pages/components/composables/modules/locales/stories للمستندات، HR links وnavigation-only redirects | بعد ثبات T4/T5 |
| T7 إزالة واختبار جامع | old-source removal، catalogs/build/deploy، regression/restore/browser | بعد الجميع |

القرار inline متسلسل لهذه الخطة. يمكن مستقبلًا فصل T6 عن كتابة migration بعد تثبيت العقود، مع كاتب واحد للـshared files والتسجيل ونسخ مستقلة. لا dispatch أثناء كتابة الخطة؛ لا تشغيل متزامن على نفس scratch DB.

---

### Task 1: تثبيت المصدر وإثبات Attachment mode وترتيب الإحلال

**Files:**
- Modify: `deploy/oca-addons.json`, `docs/oca-addons.md`.
- Create: `docs/verification/oca-dms/PROVENANCE.md`، `tools/documents_acceptance/attachment_spike.py`, `tools/documents_acceptance/migration_order.py`، `tools/documents_acceptance/README.md`.
- Test: `tools/test_oca_addons.py`؛ سكربتات scratch أعلاه تولد `result.json` وlogs خارج source.

**Interfaces:** consumes pin/report أعلاه. produces DMS path عبر `tools/oca_addons.py path` و`attachment_spike.json` و`migration_order.json`، كلاهما `passed=true` على أسماء قواعد scratch صريحة، وأوامر إعادة الإنتاج موثقة.

- [x] **1. اكتب failing fit assertions:** attachment موجود يظل نفس ID/checksum بعد بناء dms.file؛ ملفان بأسماء فريدة يرتبطان بمستند واحد؛ إنشاء record→directory عبر ORM دون sudo جديد ينجح atomically؛ فشل directory يترك صفر مستندات/مرفقات يتيمة؛ linked-record ACL يحمي التنزيل. اختبر تثبيت DMS قبل HR وبعده، ثم adoption لموديل موجود مع جدول/IDs ومرفقات ومراجع وgrants قديمة. وجود DMS سابق مع موارد/metadata غير مملوكة لهذا التطبيق يوقف preflight بدل إعادة نسبتها لشركة عشوائية؛ اعتماد تلك الحالة يحتاج خطة بيانات منفصلة.
- [x] **2. شغّل التجربة المعزولة وسجّل الفشل المتوقع** قبل adapter؛ لا تجعل اختبارًا يمر عبر superuser يثبت صلاحية مستخدم عادي. استخدم فعليًا حساب read وحساب manage وحساب بلا grant.
- [x] **3. أضف pin الخارجي وprovenance** مع ذكر LGPL في manifest وترويسات AGPL الست دون تفسير قانوني مستحدث. لا تثبت نسخة HEAD أخرى بصمت. نفذ spike الأدلة فقط؛ لا تنسخ الـmodels إلى المنتج لتجاوز الإخفاق.
- [x] **4. شغّل:** `python3 -B tools/oca_addons.py check` ثم `python3 -B tools/oca_addons.py fetch` ثم `python3 -B tools/oca_addons.py path --check`. شغّل `/dms,-benchmark,-/dms:TestDmsPortal.test_tour` بالطريقة المعزولة في التقرير. المتوقع عدد اختبارات غير صفري وصفر أخطاء، وتجربتا fit أعلاه تنجحان.
- [x] **4a. أوامر إثبات fit:** `python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database webvue_scratch_docs_fit --http-port 8294 --evidence-dir /tmp/webvue-docs-fit`، ثم `python3 -B tools/documents_acceptance/migration_order.py --baseline dc39a8eb734da4557d341fbe24b2fc63d773fbb1 --worktree "$PWD" --database-prefix webvue_scratch_docs_order --evidence-dir /tmp/webvue-docs-order`. الـCLIs المخططة ترفض أي قاعدة موجودة أو غير scratch وأي منفذ مستخدم، وتنتج JSON result يحدد كل assertion؛ لا تبدأ Odoo أو تسقط قاعدة لم ينشئها التشغيل نفسه.
- [x] **5. بوابة انتقال:** إذا لم يثبت inheritance/الإنشاء دون تجاوز/ترتيب metadata adoption، توقف قبل T2 وعدّل الخطة بالأدلة. لا تستبدله بتكرار bytes أو بsudo عام. راجع diff؛ commit فقط بتفويض صريح.

### Task 2: بناء سجل المستند ومصدر الصلاحيات الواحد

**Files:**
- Create: `odoo-addons/webvue_documents/{__init__.py,__manifest__.py,hooks.py}`.
- Create: `odoo-addons/webvue_documents/models/{__init__.py,document.py,document_grant.py,access_service.py,feature_registry.py,directory.py,document_links.py}`.
- Create: `odoo-addons/webvue_documents/security/{document_rules.xml,capability_groups.xml,ir.model.access.csv}`, `data/access_permissions.xml`.
- Create: `odoo-addons/webvue_documents/tests/{__init__.py,common.py,test_document_access.py,test_document_concurrency.py}`.
- Register: `tools/arch_layers.json`, `deploy/catalog/solutions/platform_v4.json`, `packages/contracts/src/index.ts`، والنسخ المولدة بأداة catalog الحالية.

**Interfaces:** consumes successful T1. produces schema وdomain signatures في §2–4، مع `documents.enabled` وmodule=`webvue_documents` وowner نفسه. manifest depends=`webvue_api,webvue_directory,dms` فقط. bootstrap storage/root كmodule/operator data موثوق، وليس endpoint يعطي الموظف configuration.

- [x] **1. اكتب اختبارات حمراء:** employee يرى company ولا يرى restricted بلا grant؛ editor بلا manage لا يكتب؛ manage بلا grant لا يقرأ restricted؛ system_admin لا يقرأها تلقائيًا؛ مدير قسم لا يرثها؛ companies=[A,B] مع current=A لا يقرأ B؛ companyless/foreign directory والـclient company_id ترفض؛ inactive/portal grantee يرفض؛ إزالة آخر editor ترفض؛ raw ORM write/grant يتبع القرار نفسه.
- [x] **2. شغّل:** `python3 -B tools/odoo_test.py --addons webvue_documents --no-dependents` بعد scaffolding مع tests الحمراء. المتوقع فشل الاختبارات المحددة، لا فشل إعداد بيئة أو صفر tests.
- [x] **3. نفذ schema والقدرات وrecord rules وprivate mutation helpers** وفق §2–4. use scaffold `python3 -B tools/new_app.py documents --name-ar 'المستندات' --name-en 'Documents' --route documents` بعد فحص dry-run، ثم تعديل الملفات المالكة فقط. register feature/provider للـpeople picker. قفل الشركة قبل المستند وإعادة التحقق بعد الانتظار؛ لا client context marker قابل للتزوير، ولا storage/root grants في wire payload.
- [x] **4. أضف واختبر قارئي DB مستقلين:** request1 وrequest2 نفس revision، ينجح واحد والثاني409؛ revoke role/grant يلتزم بنفس ترتيب الأقفال وينتصر قبل أي كتابة لاحقة، ويُرفض طلب كان قد قرأ capability قديمة. اختبر محاولة تغيير grant عبر model.create/write مباشرة.
- [x] **5. أعد الأمر المركز أعلاه** حتى صفر فشل وعدد غير صفري؛ تحقق company/read-only/non_saas؛ راجع diff، ولا commit دون تفويض. تنتهي T2 بدون API عامة للمستند القديم أو الجديد غير المحمية.

### Task 3: إغلاق مداخل DMS وattachment الجانبية

**Files:**
- Create: `odoo-addons/webvue_documents/models/{dms_storage.py,dms_directory.py,dms_file.py,dms_metadata.py,document_file.py,ir_attachment.py,ir_binary.py}`.
- Create: `odoo-addons/webvue_documents/controllers/{__init__.py,dms_routes.py}`.
- Create: `odoo-addons/webvue_documents/tests/{test_dms_boundaries.py,test_document_files.py,test_document_downloads.py}`.
- Modify: addon imports، security/ACL، `docs/agents/odoo-rules.md` فقط لتوثيق حدود المحرك اللازمة، لا لتخفيف المنع العام.

**Interfaces:** consumes `_webvue_can/_webvue_mutation`؛ produces `_webvue_upload`, `_webvue_set_file_active`, `_webvue_set_file_lock` في §4. extends stock behavior فقط للموارد التي يملكها webvue_documents، دون تغيير سياسة مرفقات PMO/meetings/finance.

- [x] **1. اكتب اختبارات حمراء لكل bypass:** `/my/dms/*`, `/web/binary/upload_dms_file`, `/config/dms.forbidden_extensions`, `/web/content/{attachmentId}?access_token=...`، limited-field token صالح مُنشأ في fixture، binary field على dms.file، raw RPC create/write/unlink، attachment public/token/res_model/res_id edits، وdms.storage/group/metadata writes. لا يرى قارئ سابق البايتات بعد revoke أو archive؛ حتى token صحيح لا يتجاوز قرارنا للمحتوى المُدار. library.manage لا يسمح بتغيير company/model allowlist/save_type/inherit_access أو ربط root عابر للشركات عبر client write.
- [x] **2. شغّل:** `python3 -B tools/odoo_test.py --addons webvue_documents --no-dependents`؛ احفظ أسماء الحالات الحمراء. ينجح تنزيل مستخدم مخول عبر endpoint المختبر؛ لا تعتبر منع الجميع حلاً.
- [x] **3. نفذ adapters scoped:** فرض storage/company/record linkage على search/read/write/create/download بواسطة global record rules الإضافية ووراثة DMS من سجلنا وpublic create/write/unlink guards؛ لا تضف `_search/check_access/_check_access` overrides إلى موديلات DMS أو attachment الأصلية لتجاوز architecture gate. قواعد وطرق موديل `webvue.document` المملوك لنا يجب أن تضبط `_filtered_access` الذي تستدعيه وراثة OCA أيضًا، لا HTTP checks فقط. أغلق native OCA routes للمحتوى المُدار، وامنع token generation/استعماله لذلك المحتوى. أضف guard في hook `ir.binary._record_to_stream(self, record, field_name)` قبل super للملف/المرفق المُدار: استرجع هوية caller غير المرتفعة، تحقق من المستند والملف والميزة والشركة والأرشفة، ثم فوّض الـstream الأصلي. لا يكفي check_access أو _can_return_content وحده لأن `ir.binary._find_record` يقبل limited-field token قبلها؛ المصدر `odoo/addons/base/models/ir_binary.py:23` و`ir_attachment.py:965`. هذا hook موثّق extensible في المصدر لكنه private؛ وثّق سبب R9 واختباراته دون نسخ دالة Odoo. `env.su=True` وحده ليس تفويض عميل، وbase.group_system ليس استثناء محتوى. وراثة صلاحيات Attachment storage من `webvue.document`؛ لا groups users موازية. يحظر customer unlink وفرض manager group أو context bypass. استخدم validator `webvue_api.serializers.attachment.parse_attachment_upload` بعقد `data` لا `datas` وبيانات MIME المكتشفة، دون نسخ parser HR القديم.
- [x] **3a. نفذ نطاق metadata في `dms_metadata.py`:** company_id required/default current على dms.tag/category/access.group، وglobal company rules، ومنع تغيير الشركة، والتحقق من company للـparent/category. كتابة metadata تتطلب library.manage. أعد تعريف constraint الاسم عبر ORM لكونه فريدًا داخل الشركة للـtag/access.group، لا SQL vendor يدوي ولا تعديل المصدر الخارجي. لا تزرع DMS grants ثانية. اختبر أن tag/category/group من B لا يُعد ولا يُعرض ولا يُربط بمستند A، وأن الاسم نفسه في شركتين ينجح دون كشف شركة أخرى.
- [x] **4. اختبر دورة الملفات:** 10MiB يمر وما فوقه422 قبل تخزين بايتات؛ Base64 سيئ/HTML متنكر/اسم path يرفض؛ رفع مؤهل جديد وarchive/restore/lock/unlock يرفع document.revision مرة؛ foreign file404؛ lock غير المالك يمنع؛ restore المستند لا يستعيد ملفًا مؤرشفًا قبله؛ PMO attachment غير المُدار يحتفظ بسلوكه. عند quota=0 يفشل الرفع بلا ملف يتيم، وعند إعادة استخدام attachment لا تزيد bytes، والأرشفة لا تنقص usage، ورفعا ملفين متزامنين لا يتجاوزان quota. راجع ترتيب قفل profile المستخدم أصلًا في quota مع أقفال policy/document؛ اختبار التزامن يثبت عدم deadlock قبل تثبيت الترتيب في helper.
- [x] **5. أعد الفحص المركز مع HTTP cases**؛ صفر فشل. أي اضطرار لتجاوز خارج الحدود الموضحة يعاد للخطة ولا يخفى بتعديل vendor. راجع diff؛ commit مشروط بالتفويض.

### Task 4: API وعقود صارمة مع تعارض حفظ مفهوم

**Files:**
- Create: `odoo-addons/webvue_documents/controllers/{documents.py,files.py,access.py,contexts.py,tags.py}`.
- Create: `odoo-addons/webvue_documents/serializers/{__init__.py,document.py,document_access.py}`.
- Create: `packages/contracts/src/documents/{index.ts,__tests__/schemas.test.ts}`.
- Create: `odoo-addons/webvue_documents/tests/{test_documents_api.py,test_document_access_api.py,test_document_contexts.py}`.
- Modify: controller imports و`packages/contracts/src/index.ts` export واحد.

**Interfaces:** consumes T2/T3 helpers؛ produces endpoints وZod schemas `DocumentSummarySchema`, `DocumentDetailSchema`, `DocumentFileSchema`, `DocumentListSchema`, `DocumentPatchSchema`, `DocumentAccessSchema`, `DocumentTagSchema` و`DocumentUploadSchema` وtypes المستنتجة في §4. field keys بين serializer وcontract واختبار key-set تتطابق.

- [x] **1. اكتب contract tests حمراء:** summary بلا body/files؛ detail له المفاتيح المحددة فقط؛ upload بـdata؛ revision integer>=1؛ unknown keys مرفوضة؛ context.kind لا يفتح موديلًا حرًا؛ GET list total مطابق للرؤية؛ stale revision409 بالـcurrent_revision؛ detail write response كامل ومحدّث.
- [x] **2. شغّل:** `npm -w packages/contracts run test -- src/documents/__tests__/schemas.test.ts` وOdoo cases الخاصة بـT4 عبر الأمر المعزول؛ احفظ الفشل.
- [x] **3. نفذ API وفق الجدول**؛ no raw read()/sudo()/old endpoint adapter. create201، grants لا تتسرب في GET detail، قوائم archived تتطلب archive+visibility، context options تتبع صلاحية provider، وunknown/missing/foreign IDs/errors تتبع §4. الـdownload يقرأ ويفحص تحت نفس request/company ولا يقبل URL/path من العميل.
- [x] **4. اختبر استمرار session بعد revoke** وشرط feature/read-only لكل JSON/binary route. invalid query department/context IDs لا تكتب. اختبار response/cache لا يستبدل مسودة محرر نص باستجابة رفع قديمة. تنزيل يفشل404/403 JSON منضبط ولا يتبع redirect إلى Odoo portal.
- [x] **5. أعد اختبارات العقود وOdoo المركزة**، صفر فشل. راجع schema parity وفحص feature، ثم commit فقط بتفويض.

### Task 5: جسر HR وترحيل واحد قابل للتحقق

**Files:**
- Create: `odoo-addons/webvue_documents_hr/{__init__.py,__manifest__.py}`.
- Create: `odoo-addons/webvue_documents_hr/models/{__init__.py,document.py,document_links.py,hr_department.py,hr_report.py,access_service.py}`.
- Create: `odoo-addons/webvue_documents_hr/tests/{__init__.py,test_hr_document_links.py,test_document_migration.py,test_document_role_migration.py}`.
- Modify: `odoo-addons/webvue_hr/models/{hr_department.py,hr_report.py,access_service.py,entitlement_service.py}`, `controllers/hr_reports.py`، `__manifest__.py` وimports.
- Create version migrations: `odoo-addons/webvue_hr/migrations/19.0.1.4.0/{pre-migrate_documents.py,post-migrate_documents.py,end-migrate_documents.py}`؛ new addons تبدأ `19.0.1.0.0` مع hooks التي أثبتتها T1.
- Create: `tools/documents_acceptance/{preflight.py,compare.py,migration_fixture.py}` و`docs/verification/oca-dms/migration-contract.md`.
- Register bridge rank5 auto_install depends=`webvue_documents,webvue_hr` وmodule/catalog بحسب آلية الجسور الحالية.

**Interfaces:** consumes API/context hooks/schema وproof ترتيب T1. produces `hr.department` context provider؛ private HR hooks `_webvue_additional_expiring(within_days:int)->list[dict]` default=[] و`_webvue_usage()` extension في الجسر؛ snapshot/after JSON حسب عقد المقارنة أدناه.

- [x] **1. اكتب fixture ترقية حمراء من baseline القديم:** company docs للموظف والمدير، restricted default لا ينطبق بأثر رجعي، دور مخصص متعدد الشركات، HTML/expiry/nulls، attachment ID ورابط خارجي، ملفات بأسماء مكررة، attachment مشترك/مرجع غير متوقع. Assert document IDs ثابتة، نفس bytes/checksums واسم كل ملف، لا صف إضافي، grant mapping read/manage فقط. ambiguous attachment يفشل preflight قبل أول mutation، مع IDs اللازمة للمشغّل دون محتويات حساسة.
- [x] **2. شغّل fixture في scratch old→target** بالترتيب الذي أثبتته T1، مع failure injection عند rename metadata وقبل reparent وبعد بناء DMS؛ المتوقع فشل المقارنة قبل migration وقبول cleanup/restore. لا تختبر على قاعدة المطوّر لتوفير وقت التهيئة.
- [x] **3. نفذ migration المعتمدة في T1** بتوقيع `migrate(cr, version)` و`if not version:return`: adopt/rename custom model/table وmetadata/owner xmlids قبل تنظيف الموديل القديم، أعد ربط attachments إلى `webvue.document` مع الاحتفاظ IDs، وابن dms.file references دون bytes ثانية. لا تستخدم unlink للموديل القديم، ولا تفترض وجود `odoo.upgrade.util.rename_model`؛ هذه المكتبة غير موجودة في checkout المفحوص. helper adoption محلي للمigration موثق بقائمة metadata التي يغيرها ويختبر ترتيبها؛ لا SQL عشوائي على جداول أعمال Odoo.
- [x] **4. طبّق mapping والسياسة:** old read→items.read، old manage→items.manage مع read؛ preserve roles/assignment/company IDs. update grants والlegacy XMLIDs وdependencies قبل حذف مفاتيح hr.documents القديمة؛ repair builtin grants الحالي يضيف فقط ولا يزيل، لذا removal migration صريح. حمل قيمة hr.enabled القديمة إلى documents.enabled وفق tenant policy المخوّلة؛ لا تفتح التطبيق لكل tenant تلقائيًا ولا تضف vendor runtime dependency. قيود مصدر commercial الموقّع تعالج عبر مسار تحديث policy الموثوق في release tooling، لا تزوير digest داخل addon migration.
- [x] **5. نفذ الجسر دون رفع صلاحيات:** linking قسم يحتاج current company+hr.departments.read؛ read doc مستقل لا يحتاج HR. تقارير expiry تضم فقط docs المرئية مع features التطبيقين، وHR وحده يعمل. حذف قسم فيه مستند مرئي أو مخفي يرفض department_in_use؛ حيث لا يملك caller docs.read استخدم FK restrict ورفضًا عامًا داخل savepoint بدل كشف أسماء/أعداد مستندات مخفية أو sudo. لا يقرأ HR موديل documents مباشرة؛ provider/hook من الجسر فقط.
- [x] **6. تحقق:** `python3 -B tools/odoo_test.py --addons webvue_documents,webvue_documents_hr,webvue_hr --no-dependents`، ثم fixture upgrade مرتين وclean install. المتوقع صفر فشل، stable IDs/attachments/checksums، صفر duplicate links، وHR standalone بلا bridge ينجح. احفظ manifest hashes ومخرجات compare؛ commit فقط بتفويض.

**Harness CLI المخطط:** `migration_fixture.py --baseline <sha> --worktree <absolute> --database-prefix webvue_scratch_docs_mig --evidence-dir <absolute>` ينشئ baseline/data المصطنعة ويجري lifecycle الترقية ثم repeat؛ `preflight.py --database <scratch> --output <absolute.json>` جرد read-only يرفض غير scratch في الوضع الاختباري؛ `compare.py --before <json> --after <json>` يرجع 0 فقط مع mapping مطابق وبلا روابط أو بايتات زائدة. أي تفويض لجرد قاعدة فعلية يستعمل وضع operator صريح منفصل ولا يضعه المنفذ ضمن أوامر الاختبار الافتراضية.

**Migration comparison JSON:** `documents:[{id,company_id,department_id,name,body_sha256,expiry_date}]`, `attachments:[{id,document_id,name,bytes_sha256,size}]`, `role_grants:[{role_id,company_id,old_keys,new_keys}]`؛ snapshot محلي محمي، بلا body/bytes خام أو credentials. fixtures المصطنعة تبقى في الاختبارات فقط. shared/ambiguous old attachment لا ينسخ تلقائيًا؛ تتوقف العملية وتبقى maintenance قبل اعتماد معالجة صريحة.

### Task 6: واجهة مستقلة وحفظ الروابط والمسودات

**Files:**
- Create: `apps/web/app/modules/documents/manifest.ts`, `apps/web/app/modules/documents/entryRedirect.ts`.
- Create: `apps/web/app/pages/documents.vue`, `pages/documents/{new.vue,[documentId].vue,[documentId]/edit.vue,[documentId]/access.vue}`.
- Move/adapt: DocumentEditor/Reader/CreateForm/List من `components/hr/` إلى `components/documents/`؛ no copy + old variant.
- Create: `components/documents/{DocumentFiles.vue,DocumentAccessForm.vue}`, `composables/useDocuments.ts`, `lib/documentKeys.ts`.
- Move/adapt: documentListCache وdocumentEditorDraft والاختبارات التابعة حسب مالكها الجديد؛ no legacy exports.
- Create: `apps/web/i18n/locales/{ar,en}/documents.json`, `apps/web/stories/documents/{DocumentFiles,DocumentAccessForm}.stories.ts` وقصص المكونات المركبة المنقولة.
- Create: `apps/web/app/middleware/document-entry-redirect.global.ts`؛ مسؤولية واحدة: استهلاك legacy navigation وتحويله.
- Modify: HR manifest وDepartmentTree وصفحة القسم وhrReturnTo وnav/{createActions,quickViewsModel} وصفحة home وHR locales لاستخدام المدخل الجديد؛ `tools/arch_layers.json` web_app ownership وcomponents prefixes عند الحاجة.
- Test: `apps/web/app/modules/documents/__tests__/entryRedirect.test.ts`, `components/documents/__tests__/access.test.ts`, `pages/documents/__tests__/editor.test.ts`, `apps/web/e2e/documents.spec.ts`.

**Interfaces:** consumes schemas/allowed_actions/API T4 وcontext provider T5؛ produces canonical UI routes وsafe returnTo. legacy `/hr/documents[ /new]` و`/hr/departments/:departmentId/documents/:documentId[/edit]` وdepartment create-entry تتحول إلى new pages مع query/hash/context؛ document IDs محفوظة من T5. helper `documentEntryRedirect(to: RouteLocationNormalized)->RouteLocationRaw|null` يرفض IDs غير الصحيحة وreturnTo الخارجي ولا يستدعي API قديمًا.

- [x] **1. اكتب tests حمراء:** إعادة توجيه old direct link في SSR وSPA مع q/offset/context/hash؛ إنشاء ثم refresh/back؛ restricted default وvisibility copy واضحة؛ read-only لا يرى تحرير/رفع/access؛ system_admin بلا docs لا تظهر له المكتبة؛ form access يعرض reader/editor ويمنع إزالة آخر editor؛ فلتر القسم يختفي عند غياب provider/capability.
- [x] **2. شغّل اختبارات الوحدة المحددة** عبر `npm -w apps/web run test -- app/modules/documents/__tests__ app/pages/documents/__tests__ app/components/documents/__tests__`؛ سجل الفشل ولا تنشئ stories وهمية لتمرير policy.
- [x] **3. انقل الواجهة إلى الملكية الجديدة** مع reuse مكونات Storybook وSharedCreatePanel وصفحات record/edit/access، وcontext generic من API. صفحة access صفحة تحرير أعمال وليست dialog. انقل shortcut 6 من HR إلى Documents بعد فحص التعارض، وامنع ظهور رابط القسم لمن لا يملك قدرة القراءة.
- [x] **4. افصل عملية الملف عن إلغاء النص:** شاشة edit تحفظ name/body/expiry/context فقط؛ رفع/أرشفة/استعادة/قفل الملف إجراء حفظ مستقل واضح في صفحة القراءة. successful mutation toast وrevision جديد. إذا كانت مسودة محرر مفتوحة في tab آخر، حفظها stale=409 مع إبقاء المسودة وزر إعادة تحميل صريح؛ لا overwrite صامت ولا إعادة seed للمسودة بعد refetch. التنقل أثناء upload محمي من فقد الحالة، ولا يدعي زر إلغاء التراجع عن ملف حُفظ.
- [x] **5. تحقق محدود:** الأوامر أعلاه + `npm -w apps/web run lint` من worktree، و`python3 -B tools/ui_policy.py`. بعد بدء stack scratch مخصص شغّل `cd apps/web && npm run test:e2e -- e2e/documents.spec.ts` مع env المعزول؛ تعامل مع الأمر من دليل Playwright الحالي. المتوقع AR/EN وثيمان والأحجام المحددة وروابط وتعارضات ورفع10MiB ورفض الحجم الأكبر. commit فقط بتفويض.

### Task 7: إزالة القديم والقبول المتكامل والاستعادة

**Files:**
- Delete after migration references are removed: `odoo-addons/webvue_hr/models/hr_document.py`, `controllers/hr_documents.py`, `serializers/hr_document.py`, `security/hr_document_rules.xml`، وثلاث ACL document القديمة، capability groups/data keys القديمة، وimports/tests/locale التي انتهى استعمالها.
- Remove old business pages/components/composables/contracts من HR؛ redirect helper في T6 فقط يحفظ navigation. لا `/api/v1/hr/documents` write/read adapter بعد الإحلال.
- Modify: `packages/contracts/src/hr/index.ts`, `src/access/access.ts` وknown namespaces/tests، HR report tests، root docs ownership، catalog/install list ومراجع النشر المتأثرة.
- Review/update only where tests require: `deploy/odoo/{Dockerfile,requirements-python312-linux.txt}`, `deploy/shared/{guard.mjs,guard.test.mjs}`, `deploy/releases/{dedicated_guard.mjs,test_dedicated_guard.mjs}`؛ لا توسيع allowlist لـOCA portal/RPC.
- Create: `tools/documents_acceptance/{acceptance.py,restore_drill.py}`, `docs/verification/oca-dms/acceptance.md`.

**Interfaces:** consumes all tasks. produces clean target، migration/restore evidence، matrix artifact بـactor/resource/transport/expected/actual، وتسليم بمخاطر متبقية. لا حالة تمرر local acceptance كنشر.

- [x] **1. اكتب acceptance assertions حمراء للحدود المجمعة:** الشركة A/B وtenantين منفصلين، الدور المسحوب، grant المسحوب، active/archived، files/attachment IDs وtoken/RPC/native paths، saas/non_saas/read-only/features، ورفض model/filename/header aliases. كل test يحدد caller غير superuser وتوقع200/403/404/409 بعينه.
- [x] **2. أزل البقايا فقط بعد نجاح migration fixture**؛ `rg` يثبت أن `webvue.hr.document`, `hr.documents.read/manage`, `HrDocumentSchema`, `/api/v1/hr/documents` لا تظهر في active source؛ يُسمح بها فقط في migration والاختبارات التاريخية fixture والتوثيق، وlegacy navigation paths في redirect tests/helper. فحوص architecture بلا نمو baseline ولا exemptions.
- [x] **3. شغّل مرة واحدة على النتيجة المجمعة:** focused checks ثم `npm test`، `npm -w apps/web run lint`، `npx nuxt prepare` من apps/vendor-admin ثم اختباراته إن لم تغطها البيئة المُحضّرة، `python3 -B tools/git_policy.py --base main`, `python3 -B tools/arch_policy.py --base main`. لا تستخدم `npx -w ... vue-tsc`.
- [x] **4. شغّل Odoo scratch لكل المتأثرين** وDMS: documents+bridge+HR ثم PMO/meetings/chat/finance لأن hooks عامة، مع pins/correct feature fixture وتقرير count غير صفري. شغّل standalone HR وdocuments بدون HR. لا full suites مكررة في كل task بعد نجاحها بلا تغييرات جديدة.
- [x] **5. ابن صورة Linux مرشحة مع pin** واختبر داخلها binary/native paths عبر dedicated وshared edge الحقيقيين، quota/feature expiry، وDB+filestore restore بعد الترحيل. لا تستنتج نجاح صورة الإصدار من venv macOS. قارن نفس checksums/IDs بعد الاستعادة، واجعل فشل الترحيل يبقي maintenance ولا يرجع التطبيق القديم فوق schema جديدة.
- [x] **6. راجع actual diff والترحيل مستقلًا عند التنفيذ** وفق REVIEW.md وrequesting-code-review؛ إن فُوّض reviewer فهو gpt-6.1-sol، read-only scope، baseline/evidence محددان. Jev advisory فقط إن كانت السياسة والتفويض يسمحان بإرسال diff خالٍ من الأسرار؛ لا paid API fallback، ولا يُعامل تقريره كقبول.
- [x] **7. سلّم الأدلة والمخاطر والملفات**؛ لا commit/merge/push/deploy/delete worktree دون التفويض الخاص بها. تؤجل خطوة integration-rules وfinishing-a-development-branch إلى حين طلب الدمج؛ نجاح الخطة لا يأذن به.

**Harness CLI المخطط:** `acceptance.py --worktree <absolute> --mode saas|non_saas --transport direct|dedicated|shared --database-prefix webvue_scratch_docs_accept --evidence-dir <absolute>`؛ شغّل matrix لكل وضع/نقل على موارد مستقلة. `restore_drill.py --fixture-evidence <absolute> --database-prefix webvue_scratch_docs_restore --evidence-dir <absolute>` يستعيد نسخة fixture الخاصة به ويقارن IDs/checksums؛ يرفض مسار snapshot غير صادر عن fixture وأي target موجود. نجاحها JSON passed=true وexit0؛ لا تُستخدم drop/restore على قاعدة تشاركها عملية أخرى.

## 6. طريقة تشغيل فحوص الخطة

أمر `tools/odoo_test.py --addons` يقبل الإضافات المحلية فقط؛ لذلك `/dms` يُشغّل بأمر Odoo scratch المباشر الموثق في تقرير الفحص مع مسار OCA المثبت. upstream tests تعمل standalone لإثبات المحرك، وadapter tests تعمل بهويات WebVue وسياساتها؛ لا تعتبر نجاح الأول قبولًا للثاني، ولا تضعف السياسة لكي تمنح stock DMS test user وصولًا لمكتبة WebVue. قد يجهز runner المحلي template بالإصدار الكامل؛ هذا تهيئة fixture مرة، وليس مبررًا لتكرار full test suite في كل مرحلة. اتبع `docs/agents/odoo-rules.md` للـconfig وPG environment؛ لا تضع passwords في command أو التقرير.

كل task يضيف الاختبارات إلى tests/__init__.py ويثبت red→green لسلوكه. المخرجات المتوقعة معيار مستقبلي، وليست نتائج تشغيل اليوم. تتضمن الأدلة command وbaseline SHA وsource pin وtest count وexit status ومكان logs وحدود التحقق. measurement وفق `sol61-all-v1`؛ attribution الجزئي يبقى unknown ولا يُحول إلى ادعاء توفير quota.

## 7. معايير انتهاء الإحلال

- [x] نفس المستندات القديمة وIDs والنص والقسم والانتهاء والمرفقات/بايتاتها وروابط التنزيل المهمة بعد الترحيل.
- [x] شركة حالية فقط، ولا companyless storage، ولا capability أو grant يتجاوز الآخر، ولا system_admin implicit business access.
- [x] القراءة والكتابة والتنزيل وnative/generic/attachment paths كلها تخضع للسياسة نفسها، وسحب الوصول ينعكس على الطلبات التالية وعلى الكتابة بعد انتظار القفل.
- [x] creator restricted، migrated company، role mapping ضيق، وgrants source واحد؛ لا DMS user/group lists موازية.
- [x] lost-update=409، revision واحد لكل mutation، مسودة محفوظة عند التعارض، وأرشفة/استعادة وقفل لا تحذف البيانات أو تعيد ملفات مؤرشفة خطأً.
- [x] API/contract/client مطابقون، ونقل Nuxt وفلاتر/روابط قديمة مدروسة، وHR standalone مستقل.
- [x] schema/source نظيفان، old business model/API/ACL/keys أزيلت، وsource OCA ثابت غير معدل.
- [x] fresh install/upgrade/idempotence/restore وLinux/edges/browser والمراجعة المستقلة موثقة؛ ما لم يُختبر يذكر صراحة.

## 8. مراجعة الخطة قبل التسليم

فُحصت تغطية التقرير: الملفات/المجلدات→T1/T3؛ capabilities/current-company→T2/T3؛ payload/transport→T3/T4؛ نص/expiry/department→T2/T5/T6؛ metadata/roles/policies migration→T1/T5؛ روابط/مسودات→T6؛ hooks/storage/restore/source cleanup→T7. تغطي Review Focus الخمسة اختبارات مسماة في مهامها.

نُفّذ ترتيب schema والصلاحيات والترحيل inline، ثم فُصلت الواجهة وأدوات القبول في مسار مستقل بعد ثبات العقود. اكتملت مراجعة مصدر مستقلة وأُغلقت نتائجها. بقيت التغييرات دون commit أو merge وفق تفويض المالك. توثيق حواجز baseline لا يعد قبولًا للنشر.

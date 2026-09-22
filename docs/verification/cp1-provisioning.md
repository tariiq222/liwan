# CP1-T4 — تمرير ملف التصنيف إلى التزويد وCompose وCI

## النطاق والحالة

استكمال D01 المعتمد في `codex/cp1-commercial-mode` فوق baseline `d194f93f65c377a4f2e23e3ca067514bb692805b`.
شرائح الحقول والترحيل و`/me` محفوظة؛ هذه الشريحة تربط مدخل التصنيف بأدوات التثبيت دون فوترة أو شبكة أو نشر.
لا commit/merge/push/deploy ولا تشغيل Compose حي على عميل. ليست موافقة إطلاق إنتاج.

## السلوك

1. `deploy/classification.py` يعيد استخدام `commercial_config.load_classification` على **نسخة بايتات مجمّدة** قبل أي Docker.
2. التزويد يتطلب `NASQ_COMMERCIAL_CONFIG` مسارًا مطلقًا محليًا، ويتحقق أن قاعدة الهدف تطابق الملف، وأن التثبيت الجديد بلا cutoff وبـ`preserve`.
3. اللقطة تُكتب مرة واحدة بصلاحية قراءة فقط تحت مجلد مؤقت، ثم تُمرَّر عبر overlay:
   `docker compose -f docker-compose.yml -f docker-compose.classification.yml`
   إلى `/run/nasq/classification.json` أثناء `-i` فقط.
4. `docker-compose.yml` العادي **لا** يعتمد على ملف التصنيف. إعادة التشغيل اليومية لا تحتاج mapping ولا Control Plane.
5. ترقية قائمة: المشغّل يمرّر `--expected-valid-until YYYY-MM-DD` المطابق للقيمة الحالية، أو `none` إن كانت فارغة. مسح cutoff لغير SaaS يحتاج `valid_until_action=clear` صريحًا.
6. `classification.py fixture` ينشئ مدخل scratch/CI فقط لأسماء `nasq_*scratch*`، مع `--mode` صريح. لا يولّد تصنيف إنتاج ولا يكتب فوق ملف موجود.
7. CI يمرّر mapping صريحًا في:
   - اختبار Odoo الجديد (`nasq_ci_scratch_<run>` / saas)
   - ترقية scratch (`nasq_ci_upgrade_scratch` / saas)
   - تثبيت الصورة (`nasq_image_scratch` / non_saas عبر mount للقراءة فقط)
   - مصدر استعادة (`nasq_drill_src_scratch` / non_saas)
8. بعد تصنيف قاعدة الاستعادة، يُلغى `NASQ_COMMERCIAL_CONFIG` قبل تشغيل الخدمة المستعادة؛ النسخة المصنفة تعمل بلا ملف وبلا خدمة فوترة.

## أوامر المشغّل

تثبيت جديد (بعد ملف JSON مطلق مطابق لـ`DB_NAME`):

```sh
export NASQ_COMMERCIAL_CONFIG=/absolute/operator-owned/classification.json
deploy/provision.sh app.customer.sa customerdb
```

فحص ترقية قبل `-u`، مع التاريخ المرصود حاليًا:

```sh
python3 deploy/classification.py stage \
  --file /absolute/operator-owned/classification.json \
  --output /absolute/empty/classification.json \
  --database customerdb \
  --expected-valid-until 2026-01-01
```

لا تخمّن التاريخ. اقرأه من القاعدة المستهدفة أولًا. لا تستخدم fixture على قاعدة عميل.

## ما ثبت محليًا قبل التسليم

- اختبارات `deploy/test_classification.py`: 8/8 (لقطة مجمّدة، رفض أزواج خاطئة، عدم استدعاء Docker عند فشل التحقق، تركيب overlay/CI نصيًا، تثبيت mock يمرّر اللقطة أثناء `-i` فقط).
- `npm test` من worktree: أدوات 102، عقود 178، واجهة 831.
- `npm -w apps/web run lint`: ناجح.
- مجموعة Odoo الكاملة على scratch: **642 اختبارًا، 0 فشل**.
- Docker متاح محليًا (`29.8.0`) لكن **لم يُبنَ** `nasq-odoo` ولم يُشغَّل `provision.sh` حيًا في هذه الشريحة.

## ما لم يُشغَّل

- GitHub Actions الست على هذا الفرع.
- بناء صورة Odoo كاملة وتثبيت داخلها محليًا.
- تزويد Compose حقيقي لعميل أو scratch Docker متكامل.
- إثبات egress محجوب لنسخة non_saas مستضافة.
- ترقية من وسم `release/*` حي إذا وُجد.

وجود Docker لا يُعد دليل صورة أو تزويد ناجح.

## المتبقي قبل اعتبار CP1 قابلة للإطلاق

1. تشغيل وظائف CI بعد الدمج المصرّح به، خصوصًا odoo/upgrade/image/restore-drill مع mapping.
2. تجربة تزويد scratch بـCompose overlay ثم `docker compose up` بلا overlay والتأكد أن الخدمة تعمل.
3. جرد قواعد قائمة وملف mapping صريح لكل قاعدة قبل أي `-u` إنتاجي.
4. لا فوترة ولا صفحات اشتراك في هذه المرحلة.

التقارير السابقة `cp1-commercial-mode.md` و`cp1-me-commercial.md` تبقى سجلات شرائحها. هذه الشريحة تغلق مانع التزويد/CI للتصنيف، لا تُعلن جاهزية إنتاج.

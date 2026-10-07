# سياسة الإصدارات والترحيل

**خط إصدار واحد.** كل addon يحمل `19.0.X.Y.Z`. الوسم `release/<version>` على `main` هو الإصدار.

## متى أرفع الإصدار؟

أي تغيير يمسّ مخطط القاعدة أو بيانات قائمة: حقل مخزَّن جديد أو محذوف أو متغيّر النوع، `required` جديد،
قيد SQL، إعادة تسمية موديل/حقل/xmlid، تغيير على بيانات `noupdate="1"`، تضييق record rule يعتمد على تعبئة بيانات.
التغييرات البرمجية البحتة لا ترفع الإصدار.

## كيف؟

1. ارفع `version` في `__manifest__.py` للـaddon المتأثر (Z للتصحيح، Y لتغيير مخطط).
2. أنشئ `odoo-addons/<addon>/migrations/<version>/`:
   - `pre-*.py`  قبل تحميل الموديلات (إعادة تسمية أعمدة/جداول).
   - `post-*.py` بعد التحميل (تعبئة بيانات؛ ORM عبر `api.Environment(cr, SUPERUSER_ID, {})`).
   - `end-*.py`  بعد تحديث كل الوحدات.
   كل ملف: ترويسة Odoo + `def migrate(cr, version):` ويبدأ بـ `if not version: return` (تثبيت جديد).
3. لا تغيير بيانات؟ ضع `migrations/<version>/README.md` بجملة تشرح السبب. الحارس يقبله.
4. الترحيل idempotent ولا يخمّن: حالة غامضة ⇒ `raise` برسالة تحدد المطلوب من المشغّل.

5. ترقية `nasq_pmo` إلى 19.0.1.4.0 تُثبّت `nasq_meetings` والجسر `nasq_meetings_pmo` في التشغيل نفسه؛ إن فشل تثبيت `nasq_meetings` بعد وصول `nasq_pmo` إلى 19.0.1.4.0 فالاسترداد بـ `-i nasq_meetings,nasq_meetings_pmo` (`-u` وحده لا يعيد وسمهما).

## ما لا نفعله

- لا downgrade migrations. التراجع = استرجاع DB + filestore (`deploy/restore_verify.py`).
- لا تعديل ترحيل بعد صدور وسمه. الإصلاح = إصدار جديد.

## الإصدارات المدعومة للترقية

الحالي والسابق. CI يرقّي من آخر وسم `release/*` إلى HEAD.

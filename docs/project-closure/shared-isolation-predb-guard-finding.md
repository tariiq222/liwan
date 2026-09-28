# عائق تصميم: لا توجد نقطة توسعة addon آمنة قبل اختيار قاعدة البيانات في Odoo 19

الحالة: **design blocker** — تصعيد للكابتن قبل أي تنفيذ في t5.
النطاق: قراءة فقط من `/Users/tariq/code/odoo` (rev `34eed49d…`، فرع `19.0`، نظيف، لم يُلمس).

## 1. السؤال

هل يمكن داخل addon (بلا تعديل upstream) تركيب حارس pre-dispatch على مستوى الخادم
يرفض host غير معروف، وتعارض session/DB، و`X-Odoo-Database` المزوّر — **قبل** اختيار
قاعدة البيانات؟

## 2. الجواب: لا

مسار الطلب في `odoo/http.py`:

```
root.__call__(environ)                    # ~2813
  └─ HTTPRequest(environ) / Request(httprequest)
       └─ request._post_init()            # 1809-1811
            └─ self._get_session_and_dbname()   # 1813-1851
                 ├─ session.db + db_filter([session.db], host)   # 1829
                 ├─ X-Odoo-Database + db_filter([header_dbname], host)  # 1835-1838
                 └─ db_list(force=True, host) → monodb           # 1840-1842
       ثم: if request.db → request._serve_db()                    # ~2853
```

نقاط التوسعة الموجودة كلها **بعد** اختيار القاعدة:

| نقطة | الموضع | التوقيت |
|---|---|---|
| `Dispatcher.pre_dispatch` | `http.py:2415`, يُنادى `2255` | بعد مطابقة المسار + تحميل registry |
| `ir.http._pre_dispatch` | `http.py:2383` | بعد `_serve_db` وحل الـenv |
| `ir.http._match` | `addons/base/models/ir_http.py:203` | بعد الـregistry |

`db_filter` (`http.py:389`) يدعم فقط استبدال `%h`/`%d` من `HTTP_HOST`، ولا يوفّر
hook. `_get_session_and_dbname` (1826-1848) يقبل `X-Odoo-Database` صراحةً عند غياب
`session.db` (1835-1838). لا يوجد اعتراض قابل للتسجيل من addon على هذا المسار.

`server_wide_modules` (`tools/config.py:249`، `service/server.py:1511`
`load_openerw_module`) يُحمّل الوحدة قبل الـregistry، لكنه لا يمنح hook على خط أنابيب
الطلب؛ المسار أعلاه نواة غير قابلة للتوصيل.

## 3. البدائل الممكنة (تحتاج قرار كابتن)

**أ) الحارس في ingress/proxy — لا في addon (موصى به).**
رouting يملك `deploy/shared/**`: يرفض host غير معروف، يحذف `X-Odoo-Database` الوارد من
العميل، ويصدر host موثوقًا واحدًا. يُكمَّل بـ:
- `list_db = False`
- ربط Odoo على loopback فقط، فلا يصل المتصفح إليه مباشرة
- `proxy_mode = True` مع ProxyFix النواة (`http.py:2818-2825`)
هذا يغلق direct ingress بلا تعديل Odoo، ويغطي HTTP وWS معًا لأن كليهما يمر بنفس `__call__`.

**ب) إبقاء `X-Odoo-Database` مغلقًا بالضبط.**
`dbfilter` يطابق فقط ما يُشتق من `%h`، مع `list_db=False`. لا يمنع ترويسة مطابقة،
لذلك يحتاج (أ) معه.

**ج) شيم WSGI عبر `--load` يرقّع `odoo.http.root` عند الاستيراد (post_load).**
تقنيًا "addon boundary"، لكنه monkey-patch على نواة Odoo — ليس نقطة توسعة رسمية.
يحتاج موافقة صريحة؛ لن أنفّذه بلا قرار مكتوب لأنه يخرق قاعدة "لا تعديل stock Odoo"
روحًا وليس شكلًا فحسب.

## 4. ما لن أفعله

- لن أستخدم `ir.http._pre_dispatch` أو controller بعد الـDB كبديل مزعوم لحماية direct Odoo.
- لن أزعم أن middleware Nuxt يحمي ingress المباشر إلى Odoo.
- لن أعدّل `odoo/http.py` أو أي ملف upstream.

## 5. مطلوب من الكابتن

قرار بين (أ) الحارس في ingress/proxy مع ضبط Odoo loopback+list_db=False، أو (ج)
monkey-patch من `--load` بموافقة صريحة. عقد routing (`deploy/shared/**`) يجب أن يحدد
من يملك فرض الحارس قبل أن أبدأ ربط t5.
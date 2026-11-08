# البيئة التمثيلية (staging) — تعريف مُعاد الإنتاج على OVH Openship

**الحالة:** تعريف للمراجعة فقط. لم يُنشر منه شيء، ولم يُشغَّل، ولم يُجرَّ عليه أي
قبول. هذا الملف وشقيقاته (`docker-compose.staging.yml` و`env.example` و`test_staging.py`)
تصف بيئة تمثيلية صغيرة؛ وجودها في المستودع يعني أنها **مكتوبة ومُتحقَّق من شكلها**،
لا أنها تعمل على خادم.

هذه الصفحة تسجّل **قرارات** البيئة التمثيلية وحدودها، والأرقام تأتي من
`deploy/odoo_sizing.py` كما في [صفحة تحجيم الإنتاج](../../docs/operations/odoo-sizing.md)
لا من نسخ أرقام الإنتاج.

## 1. ما الغرض منها

| الغرض | التفصيل |
| --- | --- |
| تشغيل الأدوار (persona runs) | تجربة المسارات كما يستخدمها المستخدم: الدخول، الصفحات، الصلاحيات، لا أداء ولا حمل إنتاجي |
| تمرين الترقية | تجربة `-u <addon>` وترقية صورة قبل لمس أي بيئة حقيقية |
| إثبات بناء الصور على Arm | بناء صور Odoo وNuxt والحارس لمعمار الخادم، إن ثبت أنها تُبنى |
| بيئة قابلة للتدمير | تُحذف وتُعاد من هذا التعريف؛ لا شيء فيها يستحق الاستعادة |

ما ليست له: ليست إنتاجًا، ولا نسخة من الإنتاج، ولا بديلًا عن قبول الإنتاج. لا تُقاس
عليها سعة ولا زمن استجابة ولا RPO/RTO.

## 2. الحدّ مع مشروع WordPress على الخادم نفسه

خادم OVH يستضيف أيضًا مشروع WordPress قائمًا، وهذا المشروع **خارج نطاق هذا
التعريف بالكامل**:

> مشروع WordPress على خادم OVH لا يُمسّ: لا يسمّي هذا التعريف مشروعه ولا خرائطه ولا
> شبكاته ولا منافذه على المضيف، ولا يشترك معه في حجم أو شبكة أو منفذ أو مسار نسخ.

قواعد ملزمة تنفيذًا لهذا الحدّ:

1. أسماء الأحجام والشبكات هنا مسبوقة بـ`liwan-staging-`، فلا يمكن أن تصادف اسمًا
   لمشروع آخر.
2. لا يُنشر منفذ من منافذ المضيف التي يملكها مشروع آخر: التعريف ينشر على
   `127.0.0.1` فقط وبمنافذ لا يعلنها `deploy/docker-compose.yml` (80 و443).
3. لا يُوصَل هذا التعريف بشبكة خارجية قائمة، ولا يقرأ أي مسار نسخ احتياطي أو
   bucket أو مجلد مشترك مع مشروع آخر.
4. أي تعديل يمسّ مشروع WordPress يحتاج قرارًا منفصلًا من المالك، وليس جزءًا من
   تهيئة staging.

## 3. سياسة البيانات: لا بيانات إنتاج

> لا تحمل البيئة التمثيلية أي بيانات إنتاج: لا تُستعاد فيها نسخة إنتاجية، والبيانات
> إمّا تجريبية أو اصطناعية.

التفصيل:

| القاعدة | التطبيق |
| --- | --- |
| لا استعادة نسخة إنتاجية | نسخة الإنتاج (قاعدة أو filestore) لا تُنسخ إلى هنا، ولو للفحص، ولو مؤقتًا |
| بيانات تجريبية أو اصطناعية | تُولَّد ببيانات اصطناعية أو حِزم العرض، لا بأسماء عملاء حقيقيين |
| شكل بيانات الإنتاج استثناء مُوثَّق | إذا لزم شكل بيانات الإنتاج لإعادة إنتاج خلل، تُجهَّز نسخة **مجهولة الهوية** أولًا، بخطوة مستقلة معتمدة، وتُسجّل في تقريرها |
| لا نسخ عكسي | لا يُصدَّر من هنا شيء إلى الإنتاج، ولا تُشارك قاعدة أو filestore أو حجم معه |
| أسرار مستقلة | كلمات المرور والمفاتيح خاصة بهذه البيئة، وتُولَّد لها، ولا تُنسخ من الإنتاج |

القاعدة الثالثة تبقى **مقترحًا** حتى يعتمد المالك إجراء التجهيز المجهول الهوية؛
حتى ذلك الحين لا تُنقل بيانات إنتاجية بأي صورة.

## 4. الموقع والبقاء داخل المملكة

كل شيء يخصّ LiwanOS يبقى داخل السعودية (راجع
[تقرير DevOps](../operations/oracle-cloud-devops-report.md) § «بقاء البيانات داخل
السعودية»). البيئة التمثيلية ليست استثناءً.

**الوضع الحقيقي `[محجوز]`:** OVHcloud لا تعلن أي منطقة Public Cloud داخل المملكة
العربية السعودية. المناطق المعلنة في صفحة توفّرها هي فرنسا وإيطاليا وبريطانيا
وألمانيا وبولندا وكندا والولايات المتحدة وسنغافورة وأستراليا والهند، ولا واحدة منها
في السعودية. لذلك:

> لا توجد اليوم منطقة OVH داخل المملكة، فتشغيل هذه البيئة على OVH يخالف قاعدة
> البقاء داخل السعودية، ويبقى **مانعًا مفتوحًا** حتى يحسمه المالك.

الخيارات المطروحة على المالك (لم يُعتمد أي منها):

| الخيار | الأثر | الحالة |
| --- | --- | --- |
| تشغيل staging على خادم Oracle في جدة بقسم مستقل | يحقّق البقاء داخل المملكة، ويخرج عن قرار «مشروع OVH» | `[مقترح]` |
| الانتظار حتى تعلن OVH منطقة سعودية | يحفظ القرار، ويوقف كل إثبات على بيئة تمثيلية | `[مقترح]` |
| تشغيلها على OVH خارج المملكة ببيانات اصطناعية فقط | لا بيانات عملاء، لكن السجلات والصور خارج المملكة | `[مقترح]` ويحتاج اعتمادًا صريحًا |

لا يعتمد هذا الملف أي خيار، ولا يدّعي امتثالًا. حتى يُحسم، تبقى كل بنود §8 معلّقة.

## 5. التحجيم: خادم أصغر، الحساب نفسه

لا تُنسخ أرقام الإنتاج. الأرقام هنا ناتج `deploy/odoo_sizing.py` نفسه على خادم
أصغر، بعميل واحد (بيئة تمثيلية، لا مستأجرين)، ثم تُكتب في
`docker-compose.staging.yml`؛ و`deploy/staging/test_staging.py` يفشل إذا تباعد
الملف عن الحساب أو إذا لم يكن العدد أصغر من الإنتاج:

```sh
python3 -B deploy/odoo_sizing.py --ocpu 2 --memory-gib 16 --tenants 1 --render json
```

| البند | البيئة التمثيلية | الإنتاج (جدة 4/24) |
| --- | --- | --- |
| الخادم | 2 OCPU / 16 GB، عميل واحد | 4 OCPU / 24 GB، 50 عميلًا |
| `workers` | 5 | 9 |
| `max_cron_threads` | 2 | 2 |
| `db_maxconn` | 8 | 8 |
| اتصالات Odoo | 56 | 88 |
| `pgbouncer` | لا يعمل (Odoo يتصل بـ`db` مباشرة) | اختياري حتى ينجح اختبار الغمر |
| PostgreSQL `max_connections` | 208 | 338 |
| PostgreSQL `shared_buffers` | 4GB | 6GB |
| حدّ ذاكرة حاوية `odoo` | 6144 MiB | 9216 MiB |
| حدّ ذاكرة حاوية `db` | 7168 MiB | 10240 MiB |

لماذا لا يعمل pgbouncer هنا: البيئة التمثيلية بعميل واحد و56 اتصالًا، وهي داخل
208 بلا وسيط، وإضافة وسيط غير مثبت تحت الحمل تُضيف احتمال خلل لا يُقاس على هذا
الحجم. الفرق في `max_connections` (208 مقابل 338) يفسّره غياب pgbouncer: الخطة
تحجز اتصالات Odoo مباشرة بدل خادم وسيط.

## 6. المتغيرات

كل متغير يحتاجه ملف Compose موجود في [`env.example`](env.example) باسمه وقيمة بديلة
من نوع `REPLACE_WITH_...`، بلا سرّ حقيقي. نسخة القيم الحقيقية تبقى خارج Git.

| المتغير | لماذا | ملاحظة |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | اسم مشروع Openship/Compose لهذه البيئة | اسم مستقل، لا اسم مشروع آخر على الخادم |
| `STAGING_DOMAIN` | مضيف البيئة التمثيلية | لا يُستخدم نطاق الإنتاج |
| `STAGING_DB_NAME` | اسم قاعدة البيئة التمثيلية | مختلف عن اسم قاعدة الإنتاج وعن `odoo19` المحلية |
| `STAGING_DB_PASSWORD` | كلمة مرور مستخدم `odoo` في هذه القاعدة | تُولَّد لها، لا تُنسخ من الإنتاج |
| `STAGING_ODOO_CONFIG` | مسار ملف إعداد Odoo الذي يربطه Compose للقراءة فقط | مسار مطلق خارج المستودع |
| `STAGING_IMAGE_TAG` | وسم صور LiwanOS المبنية لهذه البيئة | لا `latest` ولا وسم إنتاج |
| `ODOO_COMMIT` | إصدار Odoo المثبَّت لبناء الصورة | من `deploy/odoo/ODOO_COMMIT` |

## 7. كيف يُتحقَّق من الملف بدون تشغيل

الأمر التالي لا يبدأ أي خدمة ولا يحتاج Docker يعمل بخدمات: يقرأ الملف ويوسّع
المتغيرات ويطبع النتيجة.

```sh
# 1) الشكل والمتغيرات: لا خدمة تُبدأ
docker compose --env-file deploy/staging/env.example -p liwan-staging-preview \
  -f deploy/staging/docker-compose.staging.yml config -q

# 2) اختبارات القواعد في هذا التعريف (YAML فقط، بلا Docker ولا شبكة)
cd "$(git rev-parse --show-toplevel)" && PYTHONPATH=deploy \
  python3 -m unittest deploy.staging.test_staging -v

# 3) أرقام التحجيم لهذه البيئة، للمقارنة بما في الملف
python3 -B deploy/odoo_sizing.py --ocpu 2 --memory-gib 16 --tenants 1 --render json
```

`deploy/staging/test_staging.py` يفشل إذا اختفت إحدى القواعد: تثبيت الصور بـdigest،
أرقام التحجيم المحسوبة، تعارض منافذ المضيف مع تعريف الإنتاج، خلو التعريف من أسماء
الإنتاج وWordPress، خصائص التقوية مقابل الملف الأساسي، توثيق كل متغير، وخلو
`env.example` من أي قيمة تشبه سرًّا، وسياسة البيانات وحدّ WordPress في هذه الصفحة.

## 8. ما لم يُثبَت

| البند | الحالة |
| --- | --- |
| نشر أي خدمة من هذا التعريف | لم يُنشر شيء، على أي خادم `[غير مختبر]` |
| تشغيل الأمر `docker compose config` على جهاز المالك | ليس جزءًا من الاختبارات الآلية `[غير مختبر]` |
| وجود مشروع Openship باسم هذه البيئة | لم يُنشأ `[محجوز]` |
| منطقة OVH داخل المملكة | غير متوفرة اليوم `[محجوز]` |
| قرار السجل (registry) الذي تُسحب منه الصور | غير محسوم `[محجوز]` |
| بناء صور Nuxt والحارس لمعمار Arm | لم يُثبت `[غير مختبر]` |
| احترام Openship لـ`networks` و`profiles` و`build.args` في وضع Compose | تقرير DevOps يسجّل أنها لا تُقرأ `[غير مختبر]` |
| مسار الحافة وTLS: هل تنتهي الشهادة عند Openship edge أم عند Caddy داخل المشروع | غير محسوم `[محجوز]` |
| قبول تشغيل الأدوار أو الترقية على هذه البيئة | لم يُجرَّ أي قبول `[غير مختبر]` |
| نسخ احتياطي واستعادة لهذه البيئة | لا نسخ ولا استعادة؛ البيانات اصطناعية `[غير مختبر]` |
| قياس سعة أو زمن استجابة | لا يُقاس على هذا الحجم `[غير مختبر]` |

## 9. الأوامر التي ينفّذها المالك

هذه الأوامر لخادم البيئة التمثيلية بعد حسم §4. نفّذها من Bash. استخدم مسارًا
خاصًا خارج المستودع، ولا تشارك الملفات أو الأحجام مع مشروع آخر.

```bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# 1) جهّز ملف متغيرات خاصًا خارج المستودع، ثم املأ القيم قبل المتابعة.
umask 077
STAGING_PRIVATE=/srv/liwan-staging
install -d -m 0700 "$STAGING_PRIVATE"
STAGING_ENV="$STAGING_PRIVATE/staging.env"
# هذه الخطوة مرة واحدة فقط؛ لا تستبدل ملفًا يحوي القيم الحقيقية.
if [ ! -e "$STAGING_ENV" ]; then
  install -m 0600 deploy/staging/env.example "$STAGING_ENV"
fi
# في الملف الخاص، عيّن STAGING_ODOO_CONFIG إلى /srv/liwan-staging/odoo.conf.
# أضف STAGING_LOGIN_EMAIL لصندوق بريد فعلي تملكه هذه البيئة، وأضف
# STAGING_ODOO_ADMIN_PASSWORD وSTAGING_LOGIN_PASSWORD بكلمتين مستقلتين،
# مستقلتين أيضًا عن STAGING_DB_PASSWORD. القيم بصيغة تعيين صالحة لـ Bash.
set -a
. "$STAGING_ENV"
set +a
: "${STAGING_ODOO_ADMIN_PASSWORD:?}" "${STAGING_LOGIN_PASSWORD:?}" "${STAGING_LOGIN_EMAIL:?}"

# قاعدة هذه العينة اصطناعية: استخدم اسمًا مثل liwan_staging_scratch.
# يفشل فحص الاسم قبل بدء Docker أو إنشاء قاعدة إذا لم يكن الاسم مخصصًا للاختبار.
STAGING_CLASSIFICATION="$STAGING_PRIVATE/classification.json"
python3 -B deploy/classification.py fixture --database "$STAGING_DB_NAME" \
  --mode non_saas --output "$STAGING_CLASSIFICATION"

# 2) جهّز ملف إعداد Odoo خارج المستودع. قالب deploy/odoo.conf لا يحمل
# مفاتيح التحجيم، لذا تُضاف هنا مرة واحدة إلى الملف المؤقت الذي يُنشأ من الصفر.
STAGING_TMP="$(mktemp "$STAGING_PRIVATE/odoo.XXXXXX")"
{
  DB_NAME="$STAGING_DB_NAME" DB_PASSWORD="$STAGING_DB_PASSWORD" \
    ODOO_ADMIN_PASSWORD="$STAGING_ODOO_ADMIN_PASSWORD" \
    envsubst < deploy/odoo.conf
  python3 -B deploy/odoo_sizing.py --ocpu 2 --memory-gib 16 --tenants 1 --render odoo
} > "$STAGING_TMP"
sudo install -m 0400 -o 10001 "$STAGING_TMP" "$STAGING_ODOO_CONFIG"
rm -- "$STAGING_TMP"

stage_compose() {
  docker compose --env-file "$STAGING_ENV" -f deploy/staging/docker-compose.staging.yml "$@"
}
stage_compose config -q
stage_compose build odoo web proxy
stage_compose run --rm --no-deps -T --entrypoint test odoo -r /etc/odoo/odoo.conf

# 3) أول تهيئة فقط: شغّل PostgreSQL دون نشر الواجهة، ثم أنشئ قاعدة فارغة
# بالطريقة نفسها التي يستخدمها provision.sh واقفل CONNECT أمام PUBLIC.
stage_compose up -d --wait db
python3 -B -c '
import sys
from deploy.releases.postgres import tenant_create_database_sql, tenant_isolation_sql
db = sys.argv[1]
print(tenant_create_database_sql(db) + ";")
print(tenant_isolation_sql(db, "odoo"))
' "$STAGING_DB_NAME" | stage_compose exec -T db psql -X -U odoo -d postgres -v ON_ERROR_STOP=1

python3 -B -c 'from deploy.releases.postgres import TENANT_EXTENSION_SQL; print(TENANT_EXTENSION_SQL + ";")' \
  | stage_compose exec -T db psql -X -U odoo -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1

# 4) ثبّت المجموعة الأساسية لهذه العينة الاصطناعية بإعداد محلي non_saas.
# أضف تطبيقات السيناريو المطلوب صراحةً إلى -i؛ التهيئة بلا بيانات تجريبية من Odoo.
LIWAN_CLASSIFICATION_FILE="$STAGING_CLASSIFICATION" \
  docker compose --env-file "$STAGING_ENV" -f deploy/staging/docker-compose.staging.yml \
  -f deploy/docker-compose.classification.yml run --rm --no-deps -T odoo \
  -d "$STAGING_DB_NAME" -i liwan_directory --without-demo --no-http --stop-after-init

# غيّر كلمة مرور حساب الدخول الأول قبل تشغيل الحافة؛ القيمة لا تظهر في سطر الأوامر.
stage_compose run --rm --no-deps -T -e STAGING_LOGIN_PASSWORD -e STAGING_LOGIN_EMAIL odoo \
  shell -d "$STAGING_DB_NAME" --no-http <<'PYTHON'
import os
email = os.environ["STAGING_LOGIN_EMAIL"]
password = os.environ["STAGING_LOGIN_PASSWORD"]
if "@" not in email or email != email.strip():
    raise ValueError("Set the staging administrator mailbox")
if len(password) < 16 or password == "REPLACE_WITH_STAGING_LOGIN_PASSWORD":
    raise ValueError("Set an independent staging login password")
env.ref("base.user_admin").write({"login": email, "email": email, "password": password})
env.cr.commit()
PYTHON

# 5) بعد نجاح التهيئة فقط، شغّل الخدمات؛ المنافذ المنشورة على loopback فقط.
stage_compose up -d --wait

# 6) الإيقاف بلا حذف البيانات.
stage_compose down
```

الرقم `10001` هو UID لمستخدم `odoo` داخل الصورة. على مضيف Docker يترجم
المستخدمين، استخدم الملكية التي تظهر للحاوية بهذا الرقم؛ أمر `test -r` أعلاه
يجب أن ينجح قبل التهيئة. ملف كلمة مرور قاعدة البيانات وإعداد Odoo خارج المستودع،
ولا تُطبع نتيجة توسيع Compose التي قد تحتوي أسرارًا. الخطوات 3 و4 تخص حجم بيانات
جديدًا، ولا تُعاد على قاعدة قائمة. تبقى هذه الخطوات غير مثبتة على خادم staging.

## 10. الحالة بعلامات المستودع

| البند | العلامة |
| --- | --- |
| ملف Compose وقواعده واختباراته | `[كود]` — مقروء ومُتحقَّق منه في المستودع |
| أرقام التحجيم الصغيرة | `[كود]` — محسوبة من `deploy/odoo_sizing.py` ومربوطة باختبار |
| حدود الشبكات والتقوية | `[كود]` كما هو معلن في الملف؛ الأثر عند التشغيل `[غير مختبر]` |
| النشر على Openship | `[غير مختبر]` — لم يُنشر شيء |
| البقاء داخل المملكة | `[محجوز]` — لا منطقة OVH سعودية |
| سجل الصور | `[محجوز]` — قرار المالك |
| قبول الأدوار والترقية | `[غير مختبر]` — لم يُجرَّ أي قبول |

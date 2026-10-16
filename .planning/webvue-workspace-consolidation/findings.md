# نتائج وتثبيتات — ترتيب مساحة العمل

## حقائق الجرد الموروثة، لا إعادة audit في الإصلاح
- `main=5dc1daef`, local `origin/main=4eab6fd7`, ahead/behind `6 0` دون fetch؛ لا إثبات لحالة remote الحالية.
- commercial 340 paths (78 tracked +262 new)، UI 123 (84+39)، تقاطع 68 (47 byte-identical +21 content-different)، اتحاد **395=272 commercial-only +55 UI-only +68 shared**.
- main 16 E2E paths، PMO 7، real-lifecycle نظيف؛ first-tenant الثمانية مطابقة main عدا trailing ASCII space في tenants/new.vue، والملفان untracked ليسا عملًا فريدًا.
- `85a697f4` WIP غير متحقق/غير مختبر ضمن main؛ branch equality لا تثبت clean state أو correctness.
- UI report: 52/102 routes visited +specific journeys، لا whole-product acceptance. commercial report: E04 FAIL، E05–E16 BLOCKED، unknown cause، simulator payment؛ لا readiness claim.

## قائمة الـ21 — حفظ exact paths
1. `apps/control-plane/src/__tests__/operation-feed.test.ts`
2. `apps/control-plane/src/__tests__/packages.test.ts`
3. `apps/control-plane/src/db.ts`
4. `apps/control-plane/src/http.ts`
5. `apps/control-plane/src/packages.ts`
6. `apps/control-plane/src/shared/job-store.ts`
7. `apps/control-plane/src/shared/job-worker.ts`
8. `apps/control-plane/src/shared/odoo-adapter.ts`
9. `apps/control-plane/src/shared/onboarding.ts`
10. `apps/web/app/pages/vendor/overview.vue`
11. `apps/web/i18n/locales/ar/vendor.json`
12. `apps/web/i18n/locales/en/vendor.json`
13. `docs/design-system/catalog.json`
14. `docs/design-system/components.md`
15. `docs/superpowers/specs/2026-10-02-saas-commercial-product.md`
16. `packages/commercial-contracts/src/index.ts`
17. `packages/commercial-contracts/src/shared/provisioning.ts`
18. `tools/webvue_cli/managed_policy.py`
19. `tools/shared_saas_lifecycle/odoo_effect.py`
20. `tools/shared_saas_lifecycle/test_odoo_effect.py`
21. `tools/ui_policy.py`

## سبع مجموعات تصحيح للمراجعة
1. **الأدوار:** coordinator read-only، integration writer scoped strong واحد، verifier strong مختلف النموذج؛ Git/runtime إذن منفصل.
2. **DAG:** P0→P1→P2→P3؛ P4/P5/P6/P7 بعد scope freeze بلا overlap؛ P7→P8؛ P9 attached لكل package، لا barrier شامل؛ recordBackTargets integration وحده بعد P5/P6.
3. **الملكية:** `.gitignore` يجمع E2E/commercial private ignore hunks بكاتب واحد؛ workers لا يكتبونه. useApi/common/catalog والـ21 وvendor feed/package محجوزة؛ generated catalog بمولّده، migrations immutable/version/order محفوظة.
4. **الحساب والنطاق:** manifest exact path/hunk/hash/source/snapshot/owner/prerequisite/verify/decision لكل union وبقية العمل؛ broad globs ليست dispatch. deferred behavior محفوظ بموافقة محددة؛ closure تنظيم لا C1/C2/C3 green.
5. **baseline/promotion:** latest main pin +named accepted prerequisite commits/frozen candidate؛ tip drift يعيد candidate/reverify، dirty-main E2E intersection يحفظ ويدمج فقط بإذن commit يشمله أو يحجب، لا stash/reset/drop.
6. **التفويض والتحقق:** planning no commands؛ authorized local static/unit/build لا approval تحديث منفصل؛ live DB/Odoo/services/data/Git/provider مستقلة. E2E الخاص بالذكاء الاصطناعي يحتاج تكلفة/إرسال بيانات وscratch runtime مملوك لا autostart main3000.
7. **قبول صادق:** existing A/B/C extraction لا completion prerequisite؛ E04 source-only investigate ثم reproduction مأذون ثم source-confirmed RED/GREEN/qa؛ skip≠PASS، baseline unknown يذكر، new defect حزمة جديدة دون إضعاف assertions.

## دقة أوامر التحقق — معلومات أرسلها المنسق
- `test_odoo_effect.py` module موجود؛ الأمر المقترح `python3 -B -m unittest tools.shared_saas_lifecycle.test_odoo_effect`.
- Vitest web يستثني e2e؛ PMO Playwright يحتاج فحصه المنفصل من apps/web بURL scratch مملوك وfixture credentials خاصة؛ config الحالي worker واحد ولا webServer autostart.
- control-plane يقيّد live SQL بوجود CONTROL_TEST_DATABASE_URL؛ loopback واسم `^webvue_control_scratch_[a-z0-9]+$`، serial unique DB وnonzero affected tests؛ skip لا نجاح.
- exact remaining tests/config/resources/cwd تُجمّد P3 قبل أي dispatch؛ `npm test` fresh combined candidate ثم Odoo فقط بتفويض scratch وفق CLAUDE. لم تُشغّل هذه الأوامر.

## الحفظ والقيود والأخطاء
- source snapshot خارج repo بموقع يختاره المستخدم/يعتمد اقتراحه؛ manifest خاص بلا أسرار منشورة؛ runtime backup consistency مستقل، لا copy live PG أو forced kill، preserve existing archives.
- glob سابق على plans/ غير الموجود: no-such-directory/exit 2؛ قراءة progress قبل إنشائه: not found. minor planning read errors موروثة، لا runtime failure.
- الإصلاح النهائي قرأ وغيّر الوثائق الأربع فقط؛ لا source/refs/commands/tests/runtime/network.
- أعاد المراجع المستقل `6ed8787c` قراءة الوثائق الأربع وسلّم `PASS`، وفق تقرير المنسق: 7 معايير مستوفاة و0 findings مانعة. هذا قبول وثائق لا operational certification أو تشغيل اختبارات.
- الخطة الرئيسية 198 سطرًا حسب فحص المنسق، ولم تُعدّل بعد PASS. حدّثت سجلات التخطيط الثلاثة فقط لتسجيل الحكم؛ عرض المستخدم واعتماده pending، وجميع مراحل التنفيذ المستقبلية pending.

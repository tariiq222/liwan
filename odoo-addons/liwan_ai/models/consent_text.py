# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The AI acknowledgement and liability disclaimer a tenant signs before any AI run, on any provider (spec 2026-11-04 §6.8).

A new wording gets a new ``CONSENT_VERSION``; every consent signed for an older version stops counting at once
(spec 2026-11-04 §6.8). The signer's client echoes the version and ``CONSENT_TEXT_HASH``, proving it showed this
exact text. The wording is a draft until a legal specialist approves it (spec §10).
"""
import hashlib

CONSENT_VERSION = '2026-11-05-draft-2'

CONSENT_TEXT_AR = """مسودة بانتظار المراجعة القانونية.

إقرار استخدام الذكاء الاصطناعي وإخلاء المسؤولية

أولًا: الأطراف والأدوار
المنشأة الموقِّعة هي جهة التحكم في بياناتها. وليوان جهة معالجة تشغّل المساعد نيابة عنها. ومزوّد نموذج الذكاء الاصطناعي معالج فرعي: تختاره المنشأة إذا استخدمت مفتاحها الخاص، أو يختاره مشغّل ليوان إذا استخدمت المنشأة مزوّد المنصة.

ثانيًا: ما يُرسل وسببه
يُرسل إلى المزوّد نص المحادثة، ونتائج الأدوات التي يحتاجها المساعد ليجيب عن سؤال المستخدم، وذلك فقط ضمن ما يملك المستخدم صلاحية رؤيته في ليوان. والغرض الوحيد هو إجابة المستخدم وتنفيذ ما يطلبه بموافقته.

ثالثًا: ما لا يُرسل أبدًا
التزامًا بنظام حماية البيانات الشخصية ولوائحه الصادرة عن الهيئة السعودية للبيانات والذكاء الاصطناعي، يمنع خادم ليوان منعًا تقنيًا، مع أي مزوّد وأي مفتاح، إرسال ما يلي:
- البيانات الشخصية الحساسة: الصحية، والحيوية كالبصمة وصورة الوجه، والوراثية، والائتمانية، والدين والمعتقد، والأصل العرقي أو القبلي، والبيانات الأمنية والجنائية، وما يدل على عدم معرفة الأبوين أو أحدهما.
- رقم الهوية الوطنية والإقامة والجواز.
- رقم الآيبان والحسابات البنكية.
- الراتب والبدلات والتعويضات لكل شخص.
والمنع على مستويين: لا تُقبل أي أداة تعرض حقلًا من هذه الحقول، ثم يفحص الخادم كل نص قبل خروجه ويحجب أرقام الهوية والإقامة والآيبان وأرقام الجوال والبريد الإلكتروني المكتوبة بصيغها المعروفة.

رابعًا: الحمايات الأخرى
لكل منشأة قاعدة بيانات مستقلة، ولا يتصل خادم الذكاء إلا بالجهات المسموح بها، ويُسجَّل كل إجراء ينفذه المساعد، وتُحذف المحادثات وفق مدة الاحتفاظ المحددة في الإعدادات.

خامسًا: التزامات المنشأة
تقرّ المنشأة بأن لديها مسوّغًا نظاميًا لمعالجة البيانات بهذه الطريقة، وأنها تُبلغ موظفيها وعملاءها بذلك في سياسة الخصوصية لديها، وأنها توجّه مستخدميها إلى عدم كتابة بيانات صحية أو أرقام هوية أو غيرها من البيانات الحساسة بأيديهم داخل المحادثة؛ فالنص الحر لا يمكن ضمان اكتشاف كل ما فيه، وقد يحجب الفحص أحيانًا رقمًا عاديًا يشبه رقم هوية.

سادسًا: حدود المسؤولية
لا تتحمل ليوان مسؤولية معالجة المزوّد لما يصله من بيانات، ولا مسؤولية ما يكتبه مستخدمو المنشأة بأنفسهم داخل المحادثة، ولا مسؤولية اختيار المنشأة لمزوّدها وشروطه إذا استخدمت مفتاحها الخاص. ولا يعفي هذا الإقرار أي طرف من التزاماته النظامية.

سابعًا: السريان والسحب
يسري هذا الإقرار على المنشأة كلها، ولا يعمل المساعد قبل توقيعه. ويمكن سحبه في أي وقت من إعدادات الذكاء الاصطناعي، فيتوقف المساعد فورًا. وأي نسخة جديدة من هذا النص تتطلب توقيعًا جديدًا."""

CONSENT_TEXT_EN = """Draft pending legal review.

AI use acknowledgement and liability disclaimer

1. Parties and roles
The signing organization is the controller of its data. LiwanOS is a processor that runs the assistant on its behalf. The AI model provider is a sub-processor, chosen by the organization when it uses its own key, or by the LiwanOS operator when the organization uses the platform provider.

2. What is sent and why
The provider receives the conversation text and the tool results the assistant needs to answer the user, limited to what that user may see in LiwanOS. The only purpose is to answer the user and to carry out what the user asks, with the user's approval.

3. What is never sent
To comply with the Personal Data Protection Law and the regulations of the Saudi Data and AI Authority, the LiwanOS server technically blocks the following, for every provider and every key:
- sensitive personal data: health, biometric (such as fingerprints and face images), genetic, credit, religion or belief, ethnic or tribal origin, security and criminal data, and data revealing that one or both parents are unknown;
- national ID, iqama and passport numbers;
- IBANs and bank accounts;
- each person's salary, allowances and compensation.
The block works on two levels: no tool that exposes one of these fields is accepted, and the server scans every text before it leaves and withholds identity and iqama numbers, IBANs, mobile numbers and email addresses written in their known forms.

4. Other safeguards
Each organization has its own database, the AI server connects only to allowed hosts, every action the assistant takes is recorded, and conversations are deleted after the retention period set in the settings.

5. The organization's duties
The organization confirms that it has a lawful basis for this processing, that it informs its employees and customers in its privacy notice, and that it instructs its users not to type health data, identity numbers or other sensitive data into the conversation themselves; free text a user types cannot be guaranteed to be fully detected.

6. Limits of liability
LiwanOS is not liable for the provider's processing of the data it receives, for what the organization's users type into the conversation themselves, or for the organization's choice of provider and its terms when it uses its own key. This acknowledgement does not release any party from its legal obligations.

7. Effect and revocation
This acknowledgement applies to the whole organization, and the assistant does not run before it is signed. It can be revoked at any time from the AI settings, which stops the assistant at once. Any new version of this text requires a new signature."""

CONSENT_TEXT_HASH = hashlib.sha256(f'{CONSENT_TEXT_AR}\n{CONSENT_TEXT_EN}'.encode()).hexdigest()

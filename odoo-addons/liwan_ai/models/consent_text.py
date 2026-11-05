# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The data residency acknowledgement a tenant signs before its AI data may leave the Kingdom.

A new wording gets a new ``CONSENT_VERSION``; every consent signed for an older version stops counting at once
(spec 2026-11-04 §6.8). The signer's client echoes the version and ``CONSENT_TEXT_HASH``, proving it showed this
exact text. The wording is a draft until a legal specialist approves it (spec §10).
"""
import hashlib

CONSENT_VERSION = '2026-11-05-draft'

CONSENT_TEXT_AR = """مسودة بانتظار المراجعة القانونية.

بالتوقيع على هذا الإقرار، تفوّض المنشأة إرسال محتوى محادثات الذكاء الاصطناعي، والبيانات اللازمة للإجابة عنها، إلى مزوّد نماذج ذكاء اصطناعي يعالجها خارج المملكة العربية السعودية.

تتحمل المنشأة مسؤولية هذا النقل، وتُخلي ليوان من المسؤولية عن البيانات التي يعالجها ذلك المزوّد.

يسري هذا الإقرار على المنشأة كلها، ويمكن سحبه في أي وقت من إعدادات الذكاء الاصطناعي. وأي نسخة جديدة من هذا النص تتطلب توقيعًا جديدًا."""

CONSENT_TEXT_EN = """Draft pending legal review.

By signing this acknowledgement, the organization authorizes sending AI conversation content, and the data needed to answer it, to an AI model provider that processes it outside the Kingdom of Saudi Arabia.

The organization bears responsibility for this transfer and releases LiwanOS from liability for data processed by that provider.

This acknowledgement applies to the whole organization and can be revoked at any time from the AI settings. Any new version of this text requires a new signature."""

CONSENT_TEXT_HASH = hashlib.sha256(f'{CONSENT_TEXT_AR}\n{CONSENT_TEXT_EN}'.encode()).hexdigest()

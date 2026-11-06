# Part of Odoo. See LICENSE file for full copyright and licensing details.
import time

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_ai.models.knowledge_chunker import (
    CHUNK_CHARS,
    MAX_CHUNKS,
    record_chunks,
    record_text,
    split_text,
)
from odoo.addons.liwan_ai.models.outbound_scan import is_saudi_id, withhold_text
from odoo.addons.liwan_ai.tests.common import PROBE_SOURCE

# Valid check digits (the Luhn rule on ten digits): a citizen ID and an iqama number. Mirrors outbound.test.ts.
CITIZEN_ID = '1000000008'
IQAMA = '2000000006'


@tagged('post_install', '-at_install', 'liwan')
class TestOutboundScan(TransactionCase):
    """The Python port of apps/web/server/utils/ai/outbound.ts, case for case."""

    def test_a_saudi_id_or_iqama_is_recognised_only_when_its_check_digit_holds(self):
        self.assertTrue(is_saudi_id(CITIZEN_ID))
        self.assertTrue(is_saudi_id(IQAMA))
        self.assertFalse(is_saudi_id('1000000001'))

    def test_identity_numbers_are_withheld_and_ordinary_numbers_kept(self):
        self.assertEqual(withhold_text(f'هوية {CITIZEN_ID} وإقامة {IQAMA}'), 'هوية [national_id withheld] وإقامة [national_id withheld]')
        self.assertEqual(withhold_text('المبلغ 1000000001 ريال، والطلب 12345'), 'المبلغ 1000000001 ريال، والطلب 12345')
        self.assertEqual(
            withhold_text('الهوية 1 000 000 008 والإقامة 2000-000-006'),
            'الهوية [national_id withheld] والإقامة [national_id withheld]',
        )

    def test_arabic_indic_digits_read_like_latin_ones(self):
        self.assertEqual(withhold_text('رقم الهوية ١٠٠٠٠٠٠٠٠٨'), 'رقم الهوية [national_id withheld]')
        self.assertEqual(withhold_text('جوال ٠٥٥١٢٣٤٥٦٧'), 'جوال [phone withheld]')

    def test_saudi_ibans_are_withheld_with_or_without_spaces(self):
        self.assertEqual(withhold_text('SA0380000000608010167519'), '[iban withheld]')
        self.assertEqual(withhold_text('حوّل إلى SA03 8000 0000 6080 1016 7519 اليوم'), 'حوّل إلى [iban withheld] اليوم')
        # A value glued to other characters is still withheld; the rest of the run stays.
        self.assertEqual(withhold_text('رقمSA0380000000608010167519123'), 'رقم[iban withheld]123')

    def test_saudi_mobile_numbers_are_withheld_in_their_usual_forms(self):
        for phone in ('0551234567', '055 123 4567', '+966551234567', '00966551234567', '966 55 123 4567',
                      '+9660551234567', '(+966) 55 123 4567', '+966 (0) 55 123 4567', '055.123.4567', '055-123-4567'):
            with self.subTest(phone):
                self.assertEqual(withhold_text(f'اتصل على {phone}'), 'اتصل على [phone withheld]')
        self.assertEqual(withhold_text('الكمية 551234567'), 'الكمية 551234567')

    def test_email_addresses_are_withheld(self):
        self.assertEqual(withhold_text('راسل ahmed.ali+hr@example.com.sa'), 'راسل [email withheld]')
        self.assertEqual(withhold_text('راسل ahmed@أحمد.السعودية'), 'راسل [email withheld]')

    def test_a_long_run_without_a_match_is_scanned_in_linear_time(self):
        started = time.monotonic()
        withhold_text('a' * 200_000)
        withhold_text('a.' * 50_000 + '@')
        # Thousands of matches are replaced in one pass, not one copy of the text per match.
        withhold_text(' '.join(f'a{index}@b.sa' for index in range(14_000)))
        self.assertLess(time.monotonic() - started, 5)

    def test_names_and_ordinary_text_are_kept(self):
        self.assertEqual(withhold_text('مهام أحمد متأخرة منذ 3 أيام'), 'مهام أحمد متأخرة منذ 3 أيام')


@tagged('post_install', '-at_install', 'liwan')
class TestKnowledgeChunker(TransactionCase):

    def _partner(self, **values):
        return self.env['res.partner'].create({'name': 'Tasks partner', 'company_id': self.env.company.id, **values})

    def test_a_short_text_is_one_chunk(self):
        self.assertEqual(split_text('  hello world  '), ['hello world'])
        self.assertEqual(split_text(''), [])

    def test_a_long_text_is_cut_on_whitespace_within_the_limit(self):
        text = ' '.join(['word'] * 1000)
        chunks = split_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(0 < len(chunk) <= CHUNK_CHARS for chunk in chunks))
        self.assertTrue(all(chunk.split() == ['word'] * len(chunk.split()) for chunk in chunks))
        self.assertEqual(' '.join(chunks).split(), text.split())

    def test_a_word_longer_than_the_limit_is_cut_hard(self):
        self.assertEqual([len(chunk) for chunk in split_text('x' * 3200)], [1500, 1500, 200])

    def test_at_most_twenty_chunks_are_kept(self):
        self.assertEqual(len(split_text('x' * (CHUNK_CHARS * 40))), MAX_CHUNKS)

    def test_the_chunks_of_a_record_are_deterministic(self):
        partner = self._partner(comment='<p>' + ' '.join(['detail'] * 1200) + '</p>', function='Engineer')
        first = record_chunks(partner, PROBE_SOURCE)
        self.assertGreater(len(first), 1)
        self.assertEqual(first, record_chunks(partner, PROBE_SOURCE))
        # The language of the reader never moves a chunk boundary.
        self.assertEqual(first, record_chunks(partner.with_context(lang='ar_001'), PROBE_SOURCE))

    def test_the_text_is_the_title_then_label_value_lines_with_html_flattened(self):
        parent = self._partner(name='Parent company')
        partner = self._partner(name='Alpha', function='Engineer', comment='<p>Hello <b>world</b></p>', parent_id=parent.id)
        lines = record_text(partner, PROBE_SOURCE).split('\n')
        self.assertEqual(lines[0], 'Alpha')
        self.assertIn('Job Position: Engineer', lines)
        self.assertTrue(any(line.startswith('Notes: Hello') and 'world' in line for line in lines))
        self.assertIn('Address Type: Contact', lines)
        self.assertIn('Related Company: Parent company', lines)
        self.assertFalse(any('<' in line for line in lines))

    def test_empty_fields_add_no_line(self):
        self.assertEqual(record_text(self._partner(name='Solo', function=False), PROBE_SOURCE).split('\n')[0], 'Solo')
        self.assertNotIn('Job Position', record_text(self._partner(name='Solo', function=False), PROBE_SOURCE))

    def test_values_the_policy_withholds_never_reach_a_chunk(self):
        partner = self._partner(function='call 0551234567 or mail ali@example.sa', comment=f'<p>id {CITIZEN_ID}</p>')
        text = ' '.join(record_chunks(partner, PROBE_SOURCE))
        self.assertIn('[phone withheld]', text)
        self.assertIn('[email withheld]', text)
        self.assertIn('[national_id withheld]', text)
        for value in ('0551234567', 'ali@example.sa', CITIZEN_ID):
            self.assertNotIn(value, text)

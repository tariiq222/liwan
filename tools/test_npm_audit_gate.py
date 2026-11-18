# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from npm_audit_gate import check, parse_ignore

PM = 'GHSA-fc5q-39xc-vjpf'
OTHER = 'GHSA-aaaa-bbbb-cccc'


def adv(ghsa, severity):
    return {'source': 1, 'name': 'x', 'url': f'https://github.com/advisories/{ghsa}', 'severity': severity}


def pkg(severity, *via):
    return {'severity': severity, 'via': list(via)}


def report(**vulns):
    return {'vulnerabilities': vulns}


IGNORED = {PM: 'reason'}
PROD = ('production', 'high')
ALL = ('all dependencies', 'critical')


def run(prod, full=None, ignored=IGNORED):
    return check([(*PROD[:1], prod, PROD[1]), (*ALL[:1], full or report(), ALL[1])], ignored)


class TestAuditGate(unittest.TestCase):
    def test_listed_advisory_passes(self):
        problems, tolerated = run(report(picomatch=pkg('high', adv(PM, 'high'))))
        self.assertEqual(problems, [])
        self.assertEqual(tolerated, {PM: {'picomatch'}})

    def test_unlisted_high_in_prod_fails(self):
        problems, _ = run(report(picomatch=pkg('high', adv(PM, 'high')), foo=pkg('high', adv(OTHER, 'high'))))
        self.assertEqual(len(problems), 1)
        self.assertIn(OTHER, problems[0])

    def test_unlisted_critical_in_all_deps_fails(self):
        prod = report(picomatch=pkg('high', adv(PM, 'high')))
        problems, _ = run(prod, report(devtool=pkg('critical', adv(OTHER, 'critical'))))
        self.assertEqual(len(problems), 1)
        self.assertIn('all dependencies', problems[0])

    def test_mixed_via_fails(self):
        problems, _ = run(report(pkg_a=pkg('high', adv(PM, 'high'), adv(OTHER, 'high'))))
        self.assertEqual(len(problems), 1)
        self.assertIn(OTHER, problems[0])

    def test_transitive_chain_to_listed_passes(self):
        problems, tolerated = run(report(
            picomatch=pkg('high', adv(PM, 'high')),
            mid=pkg('high', 'picomatch'),
            top=pkg('high', 'mid'),
        ))
        self.assertEqual(problems, [])
        self.assertEqual(tolerated[PM], {'picomatch', 'mid', 'top'})

    def test_lower_severity_source_is_not_judged(self):
        problems, _ = run(report(picomatch=pkg('high', adv(PM, 'high'), adv(OTHER, 'moderate'))))
        self.assertEqual(problems, [])

    def test_stale_entry_fails(self):
        problems, _ = run(report(foo=pkg('moderate', adv(OTHER, 'moderate'))))
        self.assertEqual(len(problems), 1)
        self.assertIn('stale', problems[0])

    def test_missing_reason_fails(self):
        _, errors = parse_ignore(f'{PM}\n')
        self.assertIn('no reason', errors[0])

    def test_malformed_id_fails(self):
        _, errors = parse_ignore('GHSA-nope why\n')
        self.assertIn('malformed', errors[0])

    def test_duplicate_fails(self):
        _, errors = parse_ignore(f'{PM} one\n{PM} two\n')
        self.assertIn('duplicate', errors[0])

    def test_comments_and_blank_lines_are_skipped(self):
        ignored, errors = parse_ignore(f'# note\n\n{PM} why\n')
        self.assertEqual((ignored, errors), ({PM: 'why'}, []))


if __name__ == '__main__':
    unittest.main()

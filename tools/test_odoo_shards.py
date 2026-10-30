"""The Odoo test shards: balanced, complete, disjoint and stable."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import odoo_shards


class SplitTest(unittest.TestCase):
    WEIGHTS = {'a': 475, 'b': 372, 'c': 165, 'd': 137, 'e': 110, 'f': 97, 'g': 1}

    def test_every_module_lands_in_exactly_one_shard(self):
        shards = odoo_shards.split(self.WEIGHTS, 3)
        flat = [m for shard in shards for m in shard]
        self.assertEqual(sorted(flat), sorted(self.WEIGHTS))

    def test_shards_are_balanced_and_stable(self):
        shards = odoo_shards.split(self.WEIGHTS, 3)
        totals = [sum(self.WEIGHTS[m] for m in shard) for shard in shards]
        self.assertLessEqual(max(totals) - min(totals), 150)
        self.assertEqual(shards, odoo_shards.split(dict(reversed(list(self.WEIGHTS.items()))), 3))

    def test_selector_is_validated(self):
        self.assertEqual(odoo_shards.parse_selector('2/3'), (2, 3))
        for bad in ('0/3', '4/3', '2', 'a/b', '1/0'):
            with self.subTest(selector=bad), self.assertRaises(odoo_shards.ShardError):
                odoo_shards.parse_selector(bad)


class ShardCountTest(unittest.TestCase):
    def test_count_follows_the_share_of_the_total_weight(self):
        cases = {0: 1, 100: 1, 300: 1, 301: 2, 600: 2, 601: 3, 900: 3}
        for weight, count in cases.items():
            with self.subTest(weight=weight):
                self.assertEqual(odoo_shards.shard_count_for(weight, 900), count)

    def test_modules_never_get_more_shards_than_modules(self):
        heavy = max(odoo_shards.release_modules(), key=odoo_shards.weight)
        self.assertEqual(odoo_shards.shard_numbers([heavy]), [1])

    def test_no_modules_means_every_shard(self):
        self.assertEqual(odoo_shards.shard_numbers(), list(range(1, odoo_shards.SHARD_COUNT + 1)))

    def test_all_release_modules_need_every_shard(self):
        self.assertEqual(odoo_shards.shard_numbers(odoo_shards.release_modules()), [1, 2, 3])


class AffectedTagsTest(unittest.TestCase):
    def test_only_the_affected_modules_are_split_and_tagged(self):
        modules = ['liwan_hr', 'liwan_access_hr', 'liwan_pmo']
        count = len(odoo_shards.shard_numbers(modules))
        tagged = [t for k in range(1, count + 1) for t in odoo_shards.tags('%d/%d' % (k, count), modules).split(',')]
        self.assertEqual(sorted(tagged), sorted('/' + m for m in modules))

    def test_a_non_release_module_is_refused(self):
        with self.assertRaisesRegex(odoo_shards.ShardError, 'not_a_module'):
            odoo_shards.tags('1/1', ['liwan_hr', 'not_a_module'])

    def test_an_empty_shard_is_refused(self):
        with self.assertRaisesRegex(odoo_shards.ShardError, 'no module'):
            odoo_shards.tags('2/2', ['liwan_hr'])

    def test_the_module_list_is_parsed_and_must_not_be_empty(self):
        self.assertEqual(odoo_shards.parse_modules('a,b'), ['a', 'b'])
        with self.assertRaises(odoo_shards.ShardError):
            odoo_shards.parse_modules('')


class WeightTest(unittest.TestCase):
    def test_counts_test_methods_and_floors_at_one(self):
        with tempfile.TemporaryDirectory() as root:
            tests = Path(root) / 'm' / 'tests'
            tests.mkdir(parents=True)
            (tests / 'test_a.py').write_text('class T:\n    def test_x(self): pass\n    def test_y(self): pass\n    def helper(self): pass\n')
            (tests / 'common.py').write_text('def test_not_counted(): pass\n')
            (Path(root) / 'empty' / 'tests').mkdir(parents=True)
            self.assertEqual(odoo_shards.weight('m', Path(root)), 2)
            self.assertEqual(odoo_shards.weight('empty', Path(root)), 1)


class CommandTest(unittest.TestCase):
    def output(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(odoo_shards.main(list(argv)), 0)
        return out.getvalue().strip()

    def test_matrix_lists_every_shard_number(self):
        self.assertEqual(json.loads(self.output('matrix')), list(range(1, odoo_shards.SHARD_COUNT + 1)))

    def test_selector_picks_that_shards_tags(self):
        count = odoo_shards.SHARD_COUNT
        planned = odoo_shards.plan(count)
        for k in range(1, count + 1):
            self.assertEqual(self.output('tags', '%d/%d' % (k, count)), ','.join('/' + m for m in planned[k - 1]))

    def test_modules_narrow_the_matrix_and_the_tags(self):
        self.assertEqual(json.loads(self.output('matrix', '--modules', 'liwan_hr,liwan_access_hr')), [1])
        self.assertEqual(self.output('tags', '1/1', '--modules', 'liwan_hr,liwan_access_hr'),
                         '/liwan_access_hr,/liwan_hr')

    def test_invalid_count_and_missing_port_are_refused(self):
        with self.assertRaises(odoo_shards.ShardError):
            odoo_shards.plan(0)
        with self.assertRaises(odoo_shards.ShardError):
            odoo_shards.run_all(0)


class ReleaseTest(unittest.TestCase):
    def test_shard_tags_cover_the_release_modules_once(self):
        count = odoo_shards.SHARD_COUNT
        tagged = [t for k in range(1, count + 1) for t in odoo_shards.tags('%d/%d' % (k, count)).split(',')]
        self.assertEqual(sorted(tagged), sorted('/' + m for m in odoo_shards.release_modules()))


if __name__ == '__main__':
    unittest.main()

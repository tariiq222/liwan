"""Source-lab argument contract; this is not Docker or Odoo runtime acceptance."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from deploy.releases.migrate import source_tree_digest
from deploy.releases.state import ReleaseState,ReleaseConflict
from .source_scratch import SourceScratchRuntime


class SourceProcessTests(unittest.TestCase):
    def test_declared_two_http_workers_match_actual_arguments_and_mismatch_refuses(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();(root/'odoo-addons/demo').mkdir(parents=True)
            (root/'odoo-addons/demo/__manifest__.py').write_text("{'name':'Demo','version':'19.0.1.0.0'}")
            config=root/'odoo.conf';config.write_text('[options]\ndb_host = 127.0.0.1\ndb_user = runtime_blue\n')
            process={'pid':42,'workers':2,'configPath':str(config),'configDigest':hashlib.sha256(config.read_bytes()).hexdigest(),
                     'addonsPath':str(root/'odoo-addons'),'sourceRoot':str(root),'treeDigest':source_tree_digest(root)}
            runtime=SourceScratchRuntime(ReleaseState(root/'state'),{'mode':'local','evidenceMode':'local-source','jobsRequired':False,
                'postgres':{'host':'127.0.0.1'},'pools':{'blue':{'sourceProcess':process}}})
            argv='python odoo-bin -c '+str(config)+' --max-cron-threads=0 --workers=2 --addons-path='+process['addonsPath']
            with patch('os.kill'),patch('subprocess.check_output',return_value=argv):
                self.assertTrue(runtime._source_role('blue',{'poolId':'blue','dbUser':'runtime_blue'})['ready'])
            with patch('os.kill'),patch('subprocess.check_output',return_value=argv.replace('--workers=2','--workers=1')):
                with self.assertRaises(ReleaseConflict):runtime._source_role('blue',{'poolId':'blue','dbUser':'runtime_blue'})

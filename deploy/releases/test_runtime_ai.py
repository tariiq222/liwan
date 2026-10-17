"""Online candidate AI must use the same actual state as the serving pool."""
import copy
import unittest
from . import test_ai_maintenance as fixtures
from .runtime import LocalRuntime
from .state import atomic_json, ReleaseConflict


class RuntimeAiTests(unittest.TestCase):
    def setUp(self):
        fixtures.AiMaintenanceTests.setUp(self)

    def runtime(self, old, new):
        config=fixtures.AiMaintenanceTests.setup_config(self,old,new)
        pools=copy.deepcopy(self.pools)
        pools['pools']['green']={**pools['pools']['blue'],'poolId':'green','aiUrl':new['url']}
        atomic_json(self.state.routes/'pools.json',pools)
        return LocalRuntime(self.state,{'mode':'local','postgres':{'host':'127.0.0.1'},
            'aiTokenFile':str(self.token),'pools':{'blue':{'aiRuntime':config['oldServices'][0]},
            'green':{'aiRuntime':config['newServices'][0]}}}),pools

    def test_online_ai_checks_actual_state_and_routed_endpoint(self):
        with fixtures.ai_server() as old, fixtures.ai_server() as new:
            runtime,pools=self.runtime(old,new)
            runtime._ai_ready(self.state.binding('a'),self.m,'green')
            new['observation']['state_id']='state_'+'b'*32
            with self.assertRaises(ReleaseConflict):runtime._ai_ready(self.state.binding('a'),self.m,'green')
            new['observation']['state_id']=old['observation']['state_id']
            pools['pools']['green']['aiUrl']='http://different.invalid'
            atomic_json(self.state.routes/'pools.json',pools)
            with self.assertRaises(ReleaseConflict):runtime._ai_ready(self.state.binding('a'),self.m,'green')

    def test_serving_ai_cannot_be_silently_removed_from_candidate(self):
        with fixtures.ai_server() as old, fixtures.ai_server() as new:
            runtime,pools=self.runtime(old,new)
            del runtime.config['pools']['green']['aiRuntime']
            del pools['pools']['green']['aiUrl']
            atomic_json(self.state.routes/'pools.json',pools)
            with self.assertRaisesRegex(ReleaseConflict,'ai_shared_state_unverified'):
                runtime._ai_ready(self.state.binding('a'),self.m,'green')
            self.assertEqual(old['calls'],[])

    def test_drained_candidate_cannot_admit_new_tenant_work(self):
        with fixtures.ai_server() as old, fixtures.ai_server(accepting=False,drained=True) as new:
            runtime,_=self.runtime(old,new)
            with self.assertRaisesRegex(ReleaseConflict,'candidate_ai_not_accepting'):
                runtime._ai_ready(self.state.binding('a'),self.m,'green')


if __name__=='__main__':unittest.main()

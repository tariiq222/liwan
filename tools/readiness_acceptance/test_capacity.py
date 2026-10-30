import unittest
from . import capacity


class CapacityTests(unittest.TestCase):
    def test_failure_and_timeout_are_counted_in_attempts_and_latency(self):
        samples=[{'ms':10,'status':200,'bytes':5},{'ms':20,'status':503,'bytes':0},{'ms':30000,'status':0,'bytes':0}]
        result=capacity.summarize(samples,30)
        self.assertEqual(result['attempts'],3)
        self.assertEqual(result['errors'],2)
        self.assertEqual(result['p95Ms'],30000)
        self.assertEqual(result['statuses'],{'200':1,'503':1,'0':1})
        self.assertEqual(result['opsPerSecond'],.1)

    def test_small_sample_uses_nearest_rank_and_empty_sample_never_passes(self):
        result=capacity.summarize([{'ms':100,'status':200,'bytes':1}],1)
        self.assertEqual(result['p95Ms'],100)
        with self.assertRaises(ValueError):capacity.summarize([],1)

    def test_foreign_hosts_excessive_load_or_non_scratch_binding_refused(self):
        base={'baseUrl':'http://127.0.0.1:9001','concurrency':4,'durationSeconds':5,
              'tenants':[{'host':'a.ready.test','database':'liwan_scratch_ready_a','cookie':'synthetic','documentId':1001,'revision':3,'editIds':[2,3,4,5]}]}
        capacity.validate_config(base)
        for patch in ({'baseUrl':'https://external.invalid'},{'concurrency':1000},{'durationSeconds':0},
                      {'tenants':[{**base['tenants'][0],'database':'odoo19'}]}):
            with self.subTest(patch=patch),self.assertRaises(ValueError):capacity.validate_config({**base,**patch})

    def test_serial_load_visits_every_configured_tenant(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        import threading
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'{}')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            config={'baseUrl':'http://127.0.0.1:'+str(server.server_port),'concurrency':1,'durationSeconds':1,'maxOperations':6,
                    'tenants':[{'host':name+'.ready.test','database':'liwan_scratch_'+name,'cookie':'synthetic'} for name in ('a','b','c')]}
            result=capacity.run(config)
            self.assertEqual({s['tenant'] for s in result['samples']},{'a.ready.test','b.ready.test','c.ready.test'})
            self.assertEqual(result['tenantCount'],3)
        finally:server.shutdown();server.server_close();worker.join()

    def test_short_budget_reports_incomplete_coverage(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        import threading
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'{}')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            result=capacity.run({'baseUrl':'http://127.0.0.1:'+str(server.server_port),'concurrency':1,'durationSeconds':1,'maxOperations':1,
                'tenants':[{'host':name+'.ready.test','database':'liwan_scratch_'+name,'cookie':'synthetic'} for name in ('a','b','c')]})
            self.assertEqual(result['summary']['errors'],0)
            self.assertFalse(result['coverageComplete'])
            self.assertEqual(result['missingTenants'],['b.ready.test','c.ready.test'])
        finally:server.shutdown();server.server_close();worker.join()

    def test_http_200_login_page_is_not_a_successful_record_journey(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        import threading
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'<h1>Sign in</h1>')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            config={'baseUrl':'http://127.0.0.1:'+str(server.server_port),'operation':'record','concurrency':1,'durationSeconds':1,'maxOperations':1,
                    'tenants':[{'host':'a.ready.test','database':'liwan_scratch_a','cookie':'synthetic','documentId':1,'revision':1,'expectedName':'Actual document'}]}
            result=capacity.run(config)
            self.assertEqual(result['summary']['errors'],1)
            self.assertEqual(result['httpStatuses'],{'200':1})
        finally:server.shutdown();server.server_close();worker.join()

"""Bounded loopback HTTP journeys. Private session config never enters reports."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import http.client
import html
import json
import math
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit


def summarize(samples, seconds):
    if not samples or seconds <= 0:raise ValueError('capacity_no_samples')
    values=sorted(item['ms'] for item in samples)
    statuses={}
    for item in samples:statuses[str(item['status'])]=statuses.get(str(item['status']),0)+1
    return {'attempts':len(samples),'errors':sum(not 200<=s['status']<300 for s in samples),
            'statuses':statuses,'p50Ms':values[math.ceil(len(values)*.50)-1],
            'p95Ms':values[math.ceil(len(values)*.95)-1], 'maxMs':values[-1],
            'opsPerSecond':round(len(samples)/seconds,3),'bytes':sum(s['bytes'] for s in samples)}


def validate_config(config):
    url=urlsplit(config['baseUrl'])
    if (url.scheme!='http' or url.hostname not in ('127.0.0.1','localhost') or not url.port
            or url.username or url.password or url.path or url.query or url.fragment):raise ValueError('capacity_target_rejected')
    if (type(config['concurrency']) is not int or not 1<=config['concurrency']<=50
            or type(config['durationSeconds']) is not int or not 1<=config['durationSeconds']<=7200
            or not 1<=len(config['tenants'])<=100):raise ValueError('capacity_budget_rejected')
    if config.get('operation','list') not in ('list','record','edit'):raise ValueError('capacity_operation_rejected')
    if config.get('operation')=='edit' and config.get('allowWrites') is not True:raise ValueError('capacity_write_opt_in_required')
    if type(config.get('maxOperations',100000)) is not int or not 1<=config.get('maxOperations',100000)<=100000:raise ValueError('capacity_budget_rejected')
    for tenant in config['tenants']:
        if (not re.fullmatch(r'liwan_scratch_[a-z0-9_]{1,45}',tenant['database'])
                or not re.fullmatch(r'[a-z0-9-]+\.ready\.test',tenant['host'])
                or any('\n' in tenant.get(k,'') or '\r' in tenant.get(k,'') for k in ('cookie','host'))):raise ValueError('capacity_binding_rejected')
        if config.get('operation')=='record' and not isinstance(tenant.get('expectedName'),str):raise ValueError('capacity_record_identity_missing')
        if config.get('operation')=='edit' and len(tenant['editIds'])<config['concurrency']:raise ValueError('capacity_edit_ids_missing')


def run(config):
    validate_config(config)
    address=urlsplit(config['baseUrl']);started=time.monotonic();deadline=started+config['durationSeconds']
    lock=threading.Lock();reserved=0
    def lane(index):
        nonlocal reserved
        tenant=config['tenants'][index%len(config['tenants'])]
        connection=http.client.HTTPConnection(address.hostname,address.port,timeout=30)
        samples=[];iteration=0
        def request(method,path,body=None):
            headers={'Host':tenant['host'],'Cookie':tenant['cookie'],'Origin':'http://'+tenant['host']}
            if body is not None:headers['Content-Type']='application/json';body=json.dumps(body)
            connection.request(method,path,body=body,headers=headers)
            response=connection.getresponse();data=response.read()
            return response.status,data
        try:
            while time.monotonic()<deadline:
                with lock:
                    if reserved>=config.get('maxOperations',100000):break
                    reserved+=1
                tenant=config['tenants'][(index+iteration*config['concurrency'])%len(config['tenants'])]
                iteration+=1
                begin=time.monotonic();size=0;statuses=[];code=0;error_kind=None
                try:
                    operation=config.get('operation','list')
                    if operation=='record':
                        code,body=request('GET','/documents/'+str(tenant['documentId']));size+=len(body);statuses.append(code)
                        if code==200:
                            heading=re.search(r'<h1[^>]*>(.*?)</h1>',body.decode('utf-8'),re.S)
                            if not heading or html.unescape(re.sub(r'<[^>]+>','',heading[1])).strip()!=tenant['expectedName']:raise ValueError('record_identity')
                            code,body=request('GET',f"/api/v1/documents/{tenant['documentId']}/files?limit=50&revision={tenant['revision']}")
                            size+=len(body);statuses.append(code)
                            if code==200:
                                page=json.loads(body)
                                if not isinstance(page['items'],list) or len(page['items'])>50 or page['total']<len(page['items']) or page['revision']!=tenant['revision']:raise ValueError('file_page_contract')
                    elif operation=='edit':
                        document=tenant['editIds'][index]
                        code,body=request('GET',f'/api/v1/documents/{document}');size+=len(body);statuses.append(code)
                        if code==200:
                            revision=json.loads(body)['revision']
                            code,body=request('PATCH',f'/api/v1/documents/{document}',{'name':f'Capacity lane {index:02d} write {iteration}','expected_revision':revision})
                            size+=len(body);statuses.append(code)
                    else:
                        code,body=request('GET','/api/v1/documents?limit=50');size+=len(body);statuses.append(code)
                except (OSError,http.client.HTTPException):
                    connection.close();code=0;statuses.append(0);error_kind='transport'
                except (ValueError,KeyError,TypeError):
                    code=0;error_kind='response_contract'
                samples.append({'tenant':tenant['host'],'ms':round((time.monotonic()-begin)*1000,3),
                                'status':code,'httpStatuses':statuses,'bytes':size,'errorKind':error_kind})
        finally:connection.close()
        return samples
    with ThreadPoolExecutor(max_workers=config['concurrency']) as executor:
        samples=[item for values in executor.map(lane,range(config['concurrency'])) for item in values]
    elapsed=time.monotonic()-started
    statuses={}
    for sample in samples:
        for status in sample['httpStatuses']:statuses[str(status)]=statuses.get(str(status),0)+1
    sampled={s['tenant'] for s in samples}
    missing=sorted(t['host'] for t in config['tenants'] if t['host'] not in sampled)
    return {'coverageComplete':not missing,'missingTenants':missing,'scope':'loopback-shared-HTTP-source-lab','operation':config.get('operation','list'),
            'concurrency':config['concurrency'],'tenantCount':len({s['tenant'] for s in samples}),
            'configuredTenantCount':len(config['tenants']),
            'configuredSeconds':config['durationSeconds'],'seconds':round(elapsed,3),
            'summary':summarize(samples,elapsed),'httpStatuses':statuses,'samples':samples}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();path=Path(args.config)
    if path.stat().st_mode&0o077:raise ValueError('private_config_required')
    result=run(json.loads(path.read_text()))
    with Path(args.output).open('x') as output:json.dump(result,output,indent=2)
    print(json.dumps({k:v for k,v in result.items() if k!='samples'}))
    return 0 if result['summary']['errors']==0 and result['coverageComplete'] else 1


if __name__=='__main__':raise SystemExit(main())

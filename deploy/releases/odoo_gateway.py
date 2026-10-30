"""Trusted local scratch ORM gateway; commits CAS before launching maintenance."""
import json
from datetime import datetime

from .backup import _run
from .migrate import _local
from .scheduler import Booking, BookingConflict, BookingRef, ReleaseNotice

MARKER = 'LIWAN_BOOKING_RESULT='

SERIALIZE = '''
def snapshot(record):
    if not record:
        return None
    notice = record.release_id
    return {'id': record.id, 'revision': record.revision, 'status': record.status,
        'scheduled_at': record.scheduled_at.isoformat(), 'duration_minutes': record.duration_minutes,
        'notice': {'release_id': notice.release_id, 'deadline_at': notice.deadline_at.isoformat(),
            'estimated_seconds': notice.estimated_seconds, 'scope': notice.scope, 'status': notice.status}}
'''


class OdooBookingGateway:
    def __init__(self, state, runtime, manifest):
        self.state, self.runtime, self.manifest = state, runtime, manifest

    def _execute(self, tenant, operation):
        binding=self.state.binding(tenant)
        manifest,config=self.runtime.gateway_context(binding)
        launcher,options=_local(binding,manifest,config)
        script='''import json
from odoo import fields
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
profile = env['liwan.tenant.profile'].search([], limit=2)
if len(profile) != 1:
    raise RuntimeError('tenant_profile_invalid')
company = profile.root_company_id
records = env['liwan.maintenance.booking'].with_context(**{OPERATOR_CONTEXT: True, 'allowed_company_ids': [company.id]})
'''+SERIALIZE+operation+"\nprint('"+MARKER+"'+json.dumps(result, sort_keys=True))\n"
        output=_run([*launcher,'shell',*options,'--shell-interface=python'],config,input=script)
        rows=[line[len(MARKER):] for line in output.splitlines() if line.startswith(MARKER)]
        if len(rows)!=1: raise RuntimeError('booking_gateway_unverified')
        result=json.loads(rows[0])
        if isinstance(result,dict) and result.get('conflict'): raise BookingConflict('booking_changed')
        return result

    def due(self, now):
        result=[]
        for tenant in self.runtime.config['tenants']:
            rows=self._execute(tenant,"result = records.search([('company_id','=',company.id), '|', ('status','=','running'), '&', ('status','=','scheduled'), ('scheduled_at','<=',fields.Datetime.now())], order='scheduled_at,id').ids")
            result.extend(BookingRef(tenant,ident) for ident in rows)
        return result

    @staticmethod
    def _booking(ref, value):
        if value is None:return None
        notice=value['notice']
        return Booking(ref,value['revision'],value['status'],datetime.fromisoformat(value['scheduled_at']),value['duration_minutes'],
            ReleaseNotice(notice['release_id'],datetime.fromisoformat(notice['deadline_at']),notice['estimated_seconds'],notice['scope'],notice['status']))

    def snapshot(self,ref):
        value=self._execute(ref.tenant_id,f"record=records.search([('id','=',{int(ref.booking_id)}),('company_id','=',company.id)],limit=1)\nresult=snapshot(record)")
        return self._booking(ref,value)

    def claim(self,ref,revision,now):
        return self.transition(ref,revision,'running')

    def transition(self,ref,revision,status):
        if status not in {'running','complete','failed'} or type(revision) is not int or revision<1:raise ValueError('booking_transition_invalid')
        value=self._execute(ref.tenant_id,f'''record=records.search([('id','=',{int(ref.booking_id)}),('company_id','=',company.id)],limit=1)
try:
    if not record:
        result={{'conflict':True}}
    else:
        record._liwan_transition({status!r}, {revision})
        env.cr.commit()
        result=snapshot(record)
except LiwanAccessRule as error:
    if error.status != 409:
        raise
    env.cr.rollback()
    result={{'conflict':True}}
''')
        return self._booking(ref,value)

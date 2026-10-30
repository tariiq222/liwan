# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only, scratch-only inventory of the exact product migration preflight."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from attachment_spike import ODOO, PYTHON


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'liwan_scratch_[a-z0-9_]+',args.database):
        parser.error('scratch database required; live inventory has no authorization here')
    try:
        import psycopg2
    except ModuleNotFoundError:
        os.execv(str(PYTHON),[str(PYTHON),'-B',__file__,*sys.argv[1:]])
    sys.path.insert(0,str(ODOO))
    path=Path(__file__).resolve().parents[2]/'odoo-addons/liwan_documents/migrations/19.0.1.0.0/pre-adopt_hr.py'
    spec=importlib.util.spec_from_file_location('documents_migration_preflight',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    connection=psycopg2.connect(host='127.0.0.1',user=os.environ.get('USER','tariq'),dbname=args.database)
    try:
        connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            report=module.preflight(cursor)
        args.output.write_text(json.dumps(report,indent=2));args.output.chmod(0o600)
        print(json.dumps({'passed':not report['issues'],'issues':len(report['issues']),'ready_for_cutover':not report['requirements']}))
        return int(bool(report['issues'] or report['requirements']))
    finally:
        connection.rollback();connection.close()

if __name__=='__main__':
    sys.exit(main())

# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Compare protected, synthetic migration snapshots; emits only acceptance flags."""
import argparse
import json

MAPPING={'hr.documents.read':'documents.items.read','hr.documents.manage':'documents.items.manage'}


def compare(before,after):
    for key in ('documents','attachments','model_id','xmlids'):
        if before[key]!=after[key]:
            raise ValueError('migration mismatch: '+key)
    expected=[{**role,'keys':sorted(MAPPING.get(key,key) for key in role['keys'])} for role in before['role_grants']]
    if expected!=after['role_grants']:
        raise ValueError('migration mismatch: role_grants')
    return {'passed':True,'documents':len(after['documents']),'attachments':len(after['attachments']),
        'roles':len(after['role_grants'])}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before',required=True);parser.add_argument('--after',required=True)
    args=parser.parse_args()
    from pathlib import Path
    print(json.dumps(compare(json.loads(Path(args.before).read_text()),json.loads(Path(args.after).read_text()))))

if __name__=='__main__':
    main()

# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Helpdesk and Documents',
    'summary': 'liwan platform: file a document against a support ticket — the ticket as a document context',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec R3, rank 5): installed by Odoo as soon as liwan_documents and
    # liwan_helpdesk are both installed. It owns the ticket column of a document and the context the document
    # library offers, the same way liwan_documents_pmo offers a project; neither application knows the other.
    'depends': ['liwan_documents', 'liwan_helpdesk'],
    'auto_install': True,
    'installable': True,
    'application': False,
}

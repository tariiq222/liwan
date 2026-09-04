# Part of Odoo. See LICENSE file for full copyright and licensing details.

# Odoo's 'to_define' means "no status yet"; it is null on the wire, never a badge.
STATUS_TO_API = {
    'on_track': 'on_track',
    'at_risk': 'at_risk',
    'off_track': 'off_track',
    'on_hold': 'on_hold',
    'done': 'done',
    'to_define': None,
}


def dump_stage(stage):
    return {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold}


def dump_project(project):
    return {
        'id': project.id,
        'name': project.name,
        'status': STATUS_TO_API.get(project.last_update_status),
        # task_completion_percentage is a 0..1 ratio (0 when there are no tasks).
        'progress': round(project.task_completion_percentage * 100),
        'task_count': project.task_count,
        'closed_task_count': project.closed_task_count,
    }


def dump_project_detail(project):
    data = dump_project(project)
    data.update({
        'stages': [dump_stage(s) for s in project.type_ids.sorted(lambda s: (s.sequence, s.id))],
        'can_manage': project._nasq_can_manage(),
    })
    return data

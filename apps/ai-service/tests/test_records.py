from nasq_ai_service.records import records_from_results


def test_collects_id_name_rows_and_types_them_by_tool():
    results = [
        ("pmo.list_my_tasks", {"items": [{"id": 5, "name": "تقرير", "state": "in_progress"}], "total": 1}),
        ("pmo.get_project", {"id": 12, "name": "بوابة", "status": "on_track"}),
        ("pmo.get_project_finance_summary", {"planned": 10, "actual": 3}),
    ]
    assert records_from_results(results) == [
        {"type": "task", "id": 5, "label": "تقرير"},
        {"type": "project", "id": 12, "label": "بوابة"},
    ]


def test_deduplicates_and_caps_at_twenty():
    rows = [{"id": i, "name": f"t{i}"} for i in range(30)]
    results = [("pmo.list_my_tasks", {"items": rows}), ("pmo.list_my_tasks", {"items": rows[:3]})]
    out = records_from_results(results)
    assert len(out) == 20 and out[0] == {"type": "task", "id": 0, "label": "t0"}


def test_unknown_tool_family_yields_generic_type():
    assert records_from_results([("hr.list_people", {"items": [{"id": 1, "name": "سارة"}]})]) == [
        {"type": "record", "id": 1, "label": "سارة"},
    ]

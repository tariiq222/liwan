from liwan_ai_service.records import records_from_results


def test_collects_id_name_rows_and_types_them_by_tool():
    results = [
        ("pmo.list_my_tasks", {"items": [{"id": 5, "name": "تقرير", "state": "in_progress"}], "total": 1}),
        ("pmo.get_project", {"id": 12, "name": "بوابة", "status": "on_track"}),
        ("pmo.get_project_finance_summary", {"planned": 10, "actual": 3}),
    ]
    assert records_from_results(results, "مهمة تقرير ضمن مشروع بوابة") == [
        {"type": "task", "id": 5, "label": "تقرير"},
        {"type": "project", "id": 12, "label": "بوابة"},
    ]


TWO_TASKS = [("pmo.list_my_tasks", {"items": [{"id": 5, "name": "تقرير"}, {"id": 55, "name": "ميزانية"}]})]


def ids(answer_text, results=None):
    return [record["id"] for record in records_from_results(results or TWO_TASKS, answer_text)]


def test_only_the_mentioned_task_is_returned():
    assert ids("المتأخرة هي ميزانية") == [55]


def test_markdown_emphasis_and_case_do_not_hide_a_mention():
    results = [("pmo.list_my_tasks", {"items": [{"id": 1, "name": "Q3 Report"}]})]
    assert ids("Overdue: **q3 report**", results) == [1]
    assert ids("Overdue: `Q3\n  _Report_`", results) == [1]
    assert ids("Q3 Re*port", results) == [1]


def test_arabic_label_matches_as_a_plain_substring():
    assert ids("لديك تقرير الأسبوع متأخر") == [5]


def test_id_references_in_the_four_forms():
    for text in ("مهمة #5", "ID: 5", "id 5", "(5)", "رقم (5) متأخر"):
        assert ids(text) == [5], text


def test_id_references_never_match_inside_a_longer_number():
    assert ids("#5") == [5]  # and not 55
    assert ids("#15") == [] and ids("#555") == [] and ids("(155)") == []
    assert ids("(5) و (55)") == [5, 55]
    assert ids("5 مهام") == [] and ids("paid 5") == []


def test_labels_shorter_than_three_characters_never_match_by_label():
    results = [("pmo.list_my_tasks", {"items": [{"id": 9, "name": "أب"}]})]
    assert ids("أب هنا", results) == []
    assert ids("أب هنا #9", results) == [9]


def test_a_label_that_is_a_substring_of_another_label_matches_when_it_appears():
    # Plain substring matching: mentioning the longer label also mentions the shorter one.
    results = [("pmo.list_my_tasks", {"items": [{"id": 1, "name": "تقرير"}, {"id": 2, "name": "تقرير شهري"}]})]
    assert ids("المتأخر هو تقرير شهري", results) == [1, 2]
    assert ids("المتأخر هو تقرير", results) == [1]


def test_no_mention_means_no_records():
    assert ids("لا توجد مهام متأخرة") == []
    assert ids("") == []


def test_deduplicates_and_caps_at_twenty():
    rows = [{"id": i, "name": f"task{i}"} for i in range(30)]
    results = [("pmo.list_my_tasks", {"items": rows}), ("pmo.list_my_tasks", {"items": rows[:3]})]
    out = records_from_results(results, " ".join(row["name"] for row in rows))
    assert len(out) == 20 and out[0] == {"type": "task", "id": 0, "label": "task0"}


def test_unknown_tool_family_yields_generic_type():
    assert records_from_results([("hr.list_people", {"items": [{"id": 1, "name": "سارة"}]})], "سارة") == [
        {"type": "record", "id": 1, "label": "سارة"},
    ]

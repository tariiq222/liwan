# 19.0.1.13.0

19.0.1.12.1 → 19.0.1.13.0: `webvue.hr.compensation` gains the required selection `relationship_type`
(employee, independent contractor, consultant, other cooperation arrangement). Odoo creates the column with its
default `employee` for every existing compensation, which is what each of them was treated as before; there is
no other data step.

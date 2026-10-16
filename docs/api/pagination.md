# List pagination contract

`/api/v1` list routes use offset paging. Cursor paging is not part of this
contract and must not be introduced on one route without a versioned change.

## Request

| Query | Rule |
| --- | --- |
| `limit` | Optional non-negative integer. Missing and explicit `0` both mean the route default, because Odoo treats `search(limit=0)` as unlimited. |
| `offset` | Optional non-negative integer. Missing means `0`. |
| anything else | `422 invalid` with `field` set to the rejected name. |

`webvue_api.controllers.common.parse_page(args, default=50, maximum=200)` is the
shared reader. A route may pass a lower maximum, but it must not pass a higher
one without recording why that list cannot use the standard bound.

## Response

```json
{"items": [], "total": 0}
```

`items` is the current page. `total` is the count of records matching the same
domain, not the length of `items`. A page beyond the end is `{items: [], total: N}`,
not `404`.

## Current bounds

| Bound | Routes |
| --- | --- |
| 50 | `/api/v1/people` |
| 50 | project updates |
| 200 | employees, departments, documents, projects, tasks, notifications, meetings, and other ordinary lists |
| route-specific | a calendar month (`MAX_MONTH = 2000`) because it is a bounded date window, not an open list |

`/api/v1/people` returns a user-id picker array, not the `{items, total}`
envelope. That shape is a preserved contract and is not changed by this
standard.

## What this does not do

- It does not change an existing route cap or response shape.
- It does not add cursor pagination.
- It does not make `limit=0` mean "return everything".

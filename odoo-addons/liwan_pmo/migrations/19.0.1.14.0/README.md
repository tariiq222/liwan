# Project documents folded in

Version 19.0.1.14.0 takes over the managed project documents from the removed bridge `liwan_documents_pmo`: the
`project_id` field and context of `liwan.document` and their project scope now live in `liwan_pmo`, and `liwan_pmo`
depends on `liwan_document_service`. The module id `liwan_documents_pmo` in the feature registry goes away; the
`pmo.enabled` feature and the `liwan_pmo` module id already cover it.

The bridge had no data, security or view files, so it owned no xml ids to hand over and nothing needs a script. The
`liwan_document.project_id` column and its rows stay as they are. Forgetting the removed addon is `liwan_api`'s
`forget_removed_addons` migration.

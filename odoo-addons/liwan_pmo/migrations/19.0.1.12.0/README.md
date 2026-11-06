# Project tools and normalized objectives: fresh schema transition

Version19.0.1.12.0 removes project_project.liwan_objectives JSON and installs
liwan.project.objective. The owner approved replacement of experimental PMO
data; no copy/backfill of those objective values is supported. First acceptance
must use a newly created isolated scratch database. The fresh schema must not
contain project_project.liwan_objectives. No shared database or HR/Finance data
may be reset by installation or by this change.

Before applying this release to an existing development database, the operator
must explicitly name the database and review PMO data and bridge links to reset.
That operation is separate and has not been performed here. Do not upgrade a
shared database expecting objective-data preservation.

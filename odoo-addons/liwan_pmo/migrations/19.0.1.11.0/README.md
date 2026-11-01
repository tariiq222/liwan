Earned value adds the integer column `liwan_percent_complete` to `project_task` (default 0, checked 0..100) and the company setting `evm_progress_method`, which has no stored value and reads `binary`.
No existing row needs a script: under `binary` a done task counts 100% and any other 0%, and the new column is read only after a company chooses `manual`.

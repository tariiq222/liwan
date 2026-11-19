No data migration. The one-phone-per-company unique index on `crm_lead` became partial (open opportunities only), which only relaxes it:
no existing row can violate it, and Odoo drops and recreates the index itself on `-u` because its definition comment changed.

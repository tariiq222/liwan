New column `res_company.liwan_vat_registered` (Boolean, default false). Nothing to migrate: every existing
company is not registered for VAT, so no tax is computed or shown for it — which is what the release ships as
the default, and the setting is turned on from the company profile once a valid VAT number is entered.

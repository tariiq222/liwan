New column `res_company.liwan_vat_registered` (Boolean, default false). Nothing to migrate: every existing
company is not registered for VAT, so no tax is computed or shown for it — which is what the release ships as
the default, and the setting is turned on from the company profile once a valid VAT number is entered.

New capability `settings.company.vat.manage` (and its group), the only right to change the VAT registration. The
built-in `system_admin` role gets it from the data file and the built-in role repair on upgrade; no custom role may
hold it and the `vendor_support` role does not. Nothing to migrate: no existing role held it.

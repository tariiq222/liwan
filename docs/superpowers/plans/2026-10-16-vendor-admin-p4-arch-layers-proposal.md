# Vendor admin phase 4: proposed `tools/arch_layers.json` edit

Status: proposal for the owner. Agents do not apply it: `tools/arch_policy.py --base` counts removing a commercial
page gate as weakening, so the commit that applies it needs the `Architecture-approved-by:` trailer, added by the owner.

Why it is safe: `apps/web/app/pages/vendor/` and `apps/web/app/components/vendor/` no longer exist (the vendor console moved
to `apps/vendor-admin` in phase 3), so the `vendor` page gate checks no file and the two `allowed` prefixes match nothing.
The customer-commercial entries stay unchanged. `apps/vendor-admin` is covered by rule VA1, not by this file.

## Edit

In the `commercial` object of `tools/arch_layers.json`:

```diff
     "pages": {
       "subscription": "customer-commercial",
-      "invite": "customer-commercial",
-      "vendor": "vendor"
+      "invite": "customer-commercial"
     },
     "allowed": [
-      "apps/web/app/pages/vendor/",
       "apps/web/app/pages/subscription/",
       "apps/web/app/pages/invite/",
-      "apps/web/app/components/vendor/",
       "apps/web/app/components/subscription/",
       "apps/web/app/components/shared/commerce/",
       "apps/web/server/"
     ]
```

## Apply

1. Edit the file as above.
2. `python3 -B tools/arch_policy.py --write-baseline` (it refuses any rule whose total grows; nothing should change).
3. `python3 -B tools/arch_policy.py --base main` and `python3 -B tools/git_policy.py --base main` pass.
4. Commit `chore(tools): drop the vendor console gate from the layers`, with the owner's `Architecture-approved-by:` trailer.

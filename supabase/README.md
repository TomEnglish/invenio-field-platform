# Database lives in the MSR repository

This app shares its Supabase database with the MSR site. The database has one home: [`TomEnglish/invenio-tek-msr`, folder `supabase/`](https://github.com/TomEnglish/invenio-tek-msr/tree/main/supabase). That folder holds every migration, the seed data and the `admin-users` edge function.

Make schema changes there, as a new migration file, and never from the Supabase SQL editor.

The migrations that used to live here (001–011) moved on 2026-10-27, and three were renumbered so they apply cleanly in filename order:

| Old name here | New name in the MSR repository |
| --- | --- |
| `011_msr_table_definitions` | `009_msr_table_definitions` |
| `20260306230739_009_secure_users_rls` | `010_secure_users_rls` |
| `010_fix_rls_and_add_msr_project_id` | `011_fix_rls_and_add_msr_project_id` |

The old one-off scripts (`fix_users_rls.sql`, `make_admins.sql`, `sync_users.sql`) are archived there under `supabase/archive/field/`. The seed scripts are under `supabase/seed/`.

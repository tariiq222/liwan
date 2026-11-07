// origin/main's schema_012.sql and schema_025.sql, byte for byte, as they were before release 1.
//
// A1: schema_033 corrects seeds that only reach a database that had not applied those files yet. The correction is
// therefore only exercised by a database built from the OLD files — a fresh database applies this branch's edited
// schema_012/025 and has nothing to correct. These two files are the only migrations whose seed data release 1 edited;
// every other file applied by `migrate()` is the same in origin/main and on this branch, so replaying the branch's copy
// of the rest reproduces the old state exactly. `commercial-release1-retro-migration.test.ts` asserts that assumption
// against the real main schema directory when it is checked out, and fails loudly if a third file ever diverges.
//
// Do not update these files to match the branch: they are a fixture, not a migration.
export const MAIN_SCHEMA_FIXTURES = ['schema_012.sql', 'schema_025.sql'] as const

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
test("browser test clock refuses production databases and only overrides an explicitly isolated test process", () => {
  const run = (database: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/school-clock.mjs",
        "-e",
        "process.stdout.write(new Date().toISOString().slice(0,10))",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HALQA_TEST_CLOCK: "2026-10-29T09:00:00Z",
          DATABASE_URL: database,
          TEST_DATABASE_URL: database,
        },
      },
    );
  const refused = run(
    "postgresql://fixture:fixture@127.0.0.1:5432/school_production",
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /isolated local test database/);
  const accepted = run(
    "postgresql://fixture:fixture@127.0.0.1:5432/school_test",
  );
  assert.equal(accepted.status, 0);
  assert.equal(accepted.stdout, "2026-10-29");
});

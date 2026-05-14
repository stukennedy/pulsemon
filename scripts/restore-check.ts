import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";

const migrationsDir = path.resolve(import.meta.dir, "../migrations");
const restoreFile = process.argv[2] ?? process.env.PULSEMON_RESTORE_SQL;

const requiredTables = [
  "connections",
  "spans",
  "events",
  "metrics",
  "logs",
  "voice_turns",
  "agent_tool_calls",
  "metric_rollups_1m",
  "ingest_rate_limits",
  "monitor_evaluations",
  "alert_incidents",
  "alert_notifications",
  "ingest_cardinality_values",
  "audit_events",
  "monitor_definitions",
  "slo_definitions",
  "slo_evaluations",
];

function readCount(db: Database, table: string) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function readScalar(db: Database, query: string) {
  const row = db.prepare(query).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function applyMigrations(db: Database) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    db.exec(readFileSync(path.join(migrationsDir, file), "utf-8"));
  }

  return files;
}

function applyRestore(db: Database, file: string) {
  if (!existsSync(file)) {
    throw new Error(`Restore SQL does not exist: ${file}`);
  }

  db.exec(readFileSync(file, "utf-8"));
}

function inspectDatabase(db: Database) {
  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name)
  );
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));

  const tableCounts = Object.fromEntries(
    requiredTables
      .filter((table) => existingTables.has(table))
      .map((table) => [table, readCount(db, table)])
  );

  const warnings = [];
  if (existingTables.has("spans") && existingTables.has("connections")) {
    const orphanSpans = readScalar(db, `
      SELECT COUNT(*) AS count
      FROM spans
      WHERE connection_id IS NOT NULL
        AND connection_id NOT IN (SELECT id FROM connections)
    `);
    if (orphanSpans > 0) {
      warnings.push(`${orphanSpans} spans reference missing connections`);
    }
  }

  if (existingTables.has("logs") && existingTables.has("spans")) {
    const orphanLogs = readScalar(db, `
      SELECT COUNT(*) AS count
      FROM logs
      WHERE span_id IS NOT NULL
        AND span_id NOT IN (SELECT id FROM spans)
    `);
    if (orphanLogs > 0) {
      warnings.push(`${orphanLogs} logs reference missing spans`);
    }
  }

  return {
    missingTables,
    tableCounts,
    warnings,
  };
}

function main() {
  const migrationDb = new Database(":memory:");
  migrationDb.exec("PRAGMA foreign_keys = OFF");

  const migrations = applyMigrations(migrationDb);
  const migrationCheck = inspectDatabase(migrationDb);

  let restoreCheck: ReturnType<typeof inspectDatabase> | null = null;
  if (restoreFile) {
    const restoredDb = new Database(":memory:");
    restoredDb.exec("PRAGMA foreign_keys = OFF");
    applyRestore(restoredDb, restoreFile);
    restoreCheck = inspectDatabase(restoredDb);
  }

  const result = {
    restoreFile: restoreFile ?? null,
    migrationsApplied: migrations.length,
    latestMigration: migrations.at(-1) ?? null,
    migrationCheck,
    restoreCheck,
  };

  console.log(JSON.stringify(result, null, 2));

  if (
    migrationCheck.missingTables.length > 0 ||
    (restoreCheck?.missingTables.length ?? 0) > 0
  ) {
    process.exit(1);
  }
}

main();

type QueueOpsAction = "inspect" | "replay";

interface QueueOpsConfig {
  readonly action: QueueOpsAction;
  readonly queueName: string;
  readonly dlqName: string;
  readonly wranglerEnv?: string;
  readonly replayFile?: string;
  readonly replayUrl?: string;
  readonly replayKey?: string;
  readonly replayDryRun: boolean;
}

interface CommandResult {
  readonly command: string[];
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface QueueMessageSummary {
  readonly id: string;
  readonly signal: string;
  readonly enqueued_at: string;
  readonly age_ms: number | null;
  readonly counts: Record<string, number>;
}

function usage() {
  return [
    "Usage: bun scripts/queue-ops.ts <inspect|replay>",
    "",
    "inspect env:",
    "  PULSEMON_QUEUE_NAME=pulsemon-telemetry",
    "  PULSEMON_QUEUE_DLQ_NAME=pulsemon-telemetry-dlq",
    "  PULSEMON_QUEUE_WRANGLER_ENV=staging",
    "",
    "replay env:",
    "  PULSEMON_QUEUE_REPLAY_FILE=queue-messages.jsonl",
    "  PULSEMON_URL=https://pulsemon.example.com",
    "  PULSEMON_QUEUE_REPLAY_KEY=<maintenance-key>",
    "  PULSEMON_QUEUE_REPLAY_DRY_RUN=true",
  ].join("\n");
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function normalizedUrl(value: string | undefined) {
  if (!value) return undefined;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function actionFromArg(): QueueOpsAction {
  const action = process.argv[2] ?? "inspect";
  if (action === "inspect" || action === "replay") return action;
  if (action === "help" || action === "--help" || action === "-h") {
    console.log(usage());
    process.exit(0);
  }
  throw new Error(`Unknown queue ops action: ${action}`);
}

function config(): QueueOpsConfig {
  const baseUrl = normalizedUrl(process.env.PULSEMON_URL);
  const replayUrl = process.env.PULSEMON_QUEUE_REPLAY_URL ??
    (baseUrl ? `${baseUrl}/api/admin/queue/replay` : undefined);
  const replayKey = process.env.PULSEMON_QUEUE_REPLAY_KEY ??
    process.env.PULSEMON_MAINTENANCE_KEY;

  return {
    action: actionFromArg(),
    queueName: process.env.PULSEMON_QUEUE_NAME ?? "pulsemon-telemetry",
    dlqName: process.env.PULSEMON_QUEUE_DLQ_NAME ?? "pulsemon-telemetry-dlq",
    wranglerEnv: process.env.PULSEMON_QUEUE_WRANGLER_ENV,
    replayFile: process.env.PULSEMON_QUEUE_REPLAY_FILE,
    replayUrl,
    replayKey,
    replayDryRun: booleanEnv("PULSEMON_QUEUE_REPLAY_DRY_RUN", !replayUrl || !replayKey),
  };
}

async function runWrangler(args: string[], wranglerEnv?: string): Promise<CommandResult> {
  const command = ["bunx", "wrangler", ...args];
  if (wranglerEnv) command.push("--env", wranglerEnv);

  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    command,
    ok: exitCode === 0,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function inspectQueues(cfg: QueueOpsConfig) {
  const [list, queue, dlq] = await Promise.all([
    runWrangler(["queues", "list"], cfg.wranglerEnv),
    runWrangler(["queues", "info", cfg.queueName], cfg.wranglerEnv),
    runWrangler(["queues", "info", cfg.dlqName], cfg.wranglerEnv),
  ]);

  return {
    action: "inspect",
    queueName: cfg.queueName,
    dlqName: cfg.dlqName,
    wranglerEnv: cfg.wranglerEnv ?? null,
    checks: {
      list,
      queue,
      deadLetterQueue: dlq,
    },
    pass: list.ok && queue.ok && dlq.ok,
  };
}

function messageSummary(value: unknown): QueueMessageSummary | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "message must be an object" };
  }
  const message = value as Record<string, any>;
  if (message.version !== 1) return { error: "version must be 1" };
  if (typeof message.id !== "string") return { error: "id must be a string" };
  if (typeof message.signal !== "string") return { error: "signal must be a string" };
  if (typeof message.enqueued_at !== "string") return { error: "enqueued_at must be a string" };
  if (typeof message.context !== "object" || message.context === null) return { error: "context is required" };
  if (typeof message.batch !== "object" || message.batch === null) return { error: "batch is required" };
  if (typeof message.counts !== "object" || message.counts === null) return { error: "counts is required" };

  const enqueued = new Date(message.enqueued_at);
  const ageMs = Number.isFinite(enqueued.getTime()) ? Date.now() - enqueued.getTime() : null;

  return {
    id: message.id,
    signal: message.signal,
    enqueued_at: message.enqueued_at,
    age_ms: ageMs === null ? null : Math.max(0, ageMs),
    counts: message.counts,
  };
}

async function readJsonl(path: string) {
  const text = await Bun.file(path).text();
  const valid: unknown[] = [];
  const summaries: QueueMessageSummary[] = [];
  const invalid: { line: number; error: string }[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      const summary = messageSummary(parsed);
      if ("error" in summary) {
        invalid.push({ line: index + 1, error: summary.error });
      } else {
        valid.push(parsed);
        summaries.push(summary);
      }
    } catch (error) {
      invalid.push({
        line: index + 1,
        error: error instanceof Error ? error.message : "Invalid JSON",
      });
    }
  });

  return { valid, summaries, invalid };
}

async function replayMessages(cfg: QueueOpsConfig) {
  if (!cfg.replayFile) throw new Error("PULSEMON_QUEUE_REPLAY_FILE is required for replay");

  const parsed = await readJsonl(cfg.replayFile);
  const results: Array<{
    id: string;
    ok: boolean;
    status: number | null;
    body: unknown;
  }> = [];

  if (!cfg.replayDryRun) {
    if (!cfg.replayUrl) throw new Error("PULSEMON_QUEUE_REPLAY_URL or PULSEMON_URL is required");
    if (!cfg.replayKey) throw new Error("PULSEMON_QUEUE_REPLAY_KEY or PULSEMON_MAINTENANCE_KEY is required");

    for (const message of parsed.valid) {
      const id = (message as any).id as string;
      const response = await fetch(cfg.replayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.replayKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
      const body = await response.json().catch(() => null);
      results.push({ id, ok: response.ok, status: response.status, body });
    }
  }

  const failed = results.filter((result) => !result.ok);
  return {
    action: "replay",
    file: cfg.replayFile,
    replayUrl: cfg.replayUrl ?? null,
    dryRun: cfg.replayDryRun,
    validMessages: parsed.valid.length,
    invalidMessages: parsed.invalid.length,
    invalid: parsed.invalid,
    summaries: parsed.summaries,
    replayed: results.length,
    failed: failed.length,
    firstFailure: failed[0] ?? null,
    pass: parsed.invalid.length === 0 && failed.length === 0,
  };
}

async function main() {
  const cfg = config();
  const result = cfg.action === "inspect"
    ? await inspectQueues(cfg)
    : await replayMessages(cfg);

  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

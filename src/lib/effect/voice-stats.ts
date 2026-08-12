import type { TenantScope } from "@/types";

export type VoiceLatencyStage = "asr" | "llm" | "tts" | "audio";

export interface VoiceLatencyPercentileRow {
  readonly stage: VoiceLatencyStage;
  readonly samples: number;
  readonly avg: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

/**
 * Query latency percentiles from one indexed window of recent voice turns.
 * Invalid historical negative samples are excluded after bounding the scan.
 */
export async function queryVoiceLatencyPercentiles(
  db: D1Database,
  tenant: TenantScope
): Promise<VoiceLatencyPercentileRow[]> {
  const result = await db.prepare(
    `WITH recent AS (
       SELECT asr_latency_ms, llm_latency_ms, tts_latency_ms, audio_latency_ms
       FROM voice_turns
       WHERE workspace_id = ?1 AND project_id = ?2
       ORDER BY started_at DESC
       LIMIT 2000
     ),
     stage_latency AS (
       SELECT 'asr' AS stage, asr_latency_ms AS ms FROM recent WHERE asr_latency_ms >= 0
       UNION ALL
       SELECT 'llm', llm_latency_ms FROM recent WHERE llm_latency_ms >= 0
       UNION ALL
       SELECT 'tts', tts_latency_ms FROM recent WHERE tts_latency_ms >= 0
       UNION ALL
       SELECT 'audio', audio_latency_ms FROM recent WHERE audio_latency_ms >= 0
     ),
     ranked AS (
       SELECT stage, ms,
         ROW_NUMBER() OVER (PARTITION BY stage ORDER BY ms ASC) AS rn,
         COUNT(*) OVER (PARTITION BY stage) AS total
       FROM stage_latency
     )
     SELECT stage,
       MAX(total) AS samples,
       CAST(AVG(ms) AS INTEGER) AS avg,
       MIN(CASE WHEN rn >= CAST(((total * 50) + 99) / 100 AS INTEGER) THEN ms END) AS p50,
       MIN(CASE WHEN rn >= CAST(((total * 95) + 99) / 100 AS INTEGER) THEN ms END) AS p95,
       MIN(CASE WHEN rn >= CAST(((total * 99) + 99) / 100 AS INTEGER) THEN ms END) AS p99
     FROM ranked
     GROUP BY stage`
  ).bind(tenant.workspace_id, tenant.project_id).all<VoiceLatencyPercentileRow>();

  return result.results;
}

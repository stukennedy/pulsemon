import { Effect } from "effect";
import type { AlertIncident, AlertNotification } from "@/db/schema";
import type { Env, TenantScope } from "@/types";
import { DatabaseError } from "./errors";
import type { MonitorEvaluation } from "./monitors";

export interface AlertDeliveryConfig {
  readonly webhookUrl?: string;
  readonly webhookSecret?: string;
  readonly slackWebhookUrl?: string;
  readonly pagerDutyRoutingKey?: string;
  readonly emailWebhookUrl?: string;
}

export interface AlertProcessingResult {
  readonly opened: number;
  readonly resolved: number;
  readonly notifications: number;
}

type AlertEnv = Pick<
  Env,
  | "ALERT_WEBHOOK_URL"
  | "ALERT_WEBHOOK_SECRET"
  | "ALERT_SLACK_WEBHOOK_URL"
  | "ALERT_PAGERDUTY_ROUTING_KEY"
  | "ALERT_EMAIL_WEBHOOK_URL"
>;
type AlertFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface DeliveryTarget {
  readonly channel: "webhook" | "slack" | "pagerduty" | "email" | "none";
  readonly url?: string;
  readonly send: () => Effect.Effect<{ status: string; responseStatus?: number; error?: string }, never>;
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dbEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, DatabaseError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new DatabaseError({ message: messageFromUnknown(error) }),
  });
}

function nowIso() {
  return new Date().toISOString();
}

function activeIncidentId(tenant: TenantScope, monitorId: string) {
  return `${tenant.workspace_id}:${tenant.project_id}:${monitorId}:active`;
}

function notificationId(incidentId: string, eventType: string, sentAt: string) {
  return `${incidentId}:${eventType}:${sentAt}`;
}

function notificationIdForTarget(incidentId: string, eventType: string, sentAt: string, channel: string) {
  return `${notificationId(incidentId, eventType, sentAt)}:${channel}`;
}

export function alertConfigFromEnv(env: AlertEnv): AlertDeliveryConfig {
  return {
    webhookUrl: env.ALERT_WEBHOOK_URL?.trim() || undefined,
    webhookSecret: env.ALERT_WEBHOOK_SECRET?.trim() || undefined,
    slackWebhookUrl: env.ALERT_SLACK_WEBHOOK_URL?.trim() || undefined,
    pagerDutyRoutingKey: env.ALERT_PAGERDUTY_ROUTING_KEY?.trim() || undefined,
    emailWebhookUrl: env.ALERT_EMAIL_WEBHOOK_URL?.trim() || undefined,
  };
}

function getActiveIncident(
  db: D1Database,
  tenant: TenantScope,
  monitorId: string
): Effect.Effect<AlertIncident | null, DatabaseError> {
  return dbEffect(() => db.prepare(
    `SELECT * FROM alert_incidents
     WHERE workspace_id = ?
       AND project_id = ?
       AND monitor_id = ?
       AND status = 'firing'
     LIMIT 1`
  ).bind(tenant.workspace_id, tenant.project_id, monitorId).first<AlertIncident>());
}

function openIncident(
  db: D1Database,
  tenant: TenantScope,
  evaluation: MonitorEvaluation,
  openedAt: string
): Effect.Effect<AlertIncident, DatabaseError> {
  const incident: AlertIncident = {
    id: activeIncidentId(tenant, evaluation.monitor_id),
    workspace_id: tenant.workspace_id,
    project_id: tenant.project_id,
    monitor_id: evaluation.monitor_id,
    name: evaluation.name,
    status: "firing",
    started_at: openedAt,
    last_seen_at: openedAt,
    resolved_at: null,
    last_value: evaluation.value,
    threshold: evaluation.threshold,
    notification_count: 0,
  };

  return dbEffect(async () => {
    await db.prepare(
      `INSERT INTO alert_incidents (
        id,
        workspace_id,
        project_id,
        monitor_id,
        name,
        status,
        started_at,
        last_seen_at,
        resolved_at,
        last_value,
        threshold,
        notification_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'firing',
        last_seen_at = excluded.last_seen_at,
        resolved_at = NULL,
        last_value = excluded.last_value,
        threshold = excluded.threshold`
    ).bind(
      incident.id,
      incident.workspace_id,
      incident.project_id,
      incident.monitor_id,
      incident.name,
      incident.status,
      incident.started_at,
      incident.last_seen_at,
      incident.resolved_at,
      incident.last_value,
      incident.threshold,
      incident.notification_count
    ).run();
    return incident;
  });
}

function updateIncident(
  db: D1Database,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  seenAt: string
): Effect.Effect<AlertIncident, DatabaseError> {
  return dbEffect(async () => {
    await db.prepare(
      `UPDATE alert_incidents
       SET last_seen_at = ?,
           last_value = ?,
           threshold = ?
       WHERE id = ?`
    ).bind(seenAt, evaluation.value, evaluation.threshold, incident.id).run();
    return { ...incident, last_seen_at: seenAt, last_value: evaluation.value, threshold: evaluation.threshold };
  });
}

function resolveIncident(
  db: D1Database,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  resolvedAt: string
): Effect.Effect<AlertIncident, DatabaseError> {
  return dbEffect(async () => {
    await db.prepare(
      `UPDATE alert_incidents
       SET status = 'resolved',
           resolved_at = ?,
           last_seen_at = ?,
           last_value = ?
       WHERE id = ?`
    ).bind(resolvedAt, resolvedAt, evaluation.value, incident.id).run();
    return { ...incident, status: "resolved", resolved_at: resolvedAt, last_seen_at: resolvedAt, last_value: evaluation.value };
  });
}

function recordNotification(
  db: D1Database,
  tenant: TenantScope,
  incident: AlertIncident,
  eventType: string,
  channel: string,
  targetUrl: string | undefined,
  sentAt: string,
  result: { status: string; responseStatus?: number; error?: string }
): Effect.Effect<AlertNotification, DatabaseError> {
  const notification: AlertNotification = {
    id: notificationIdForTarget(incident.id, eventType, sentAt, channel),
    workspace_id: tenant.workspace_id,
    project_id: tenant.project_id,
    incident_id: incident.id,
    monitor_id: incident.monitor_id,
    event_type: eventType,
    target_url: targetUrl ?? channel,
    status: result.status,
    response_status: result.responseStatus ?? null,
    error: result.error ?? null,
    sent_at: sentAt,
  };

  return dbEffect(async () => {
    await db.prepare(
      `INSERT INTO alert_notifications (
        id,
        workspace_id,
        project_id,
        incident_id,
        monitor_id,
        event_type,
        target_url,
        status,
        response_status,
        error,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`
    ).bind(
      notification.id,
      notification.workspace_id,
      notification.project_id,
      notification.incident_id,
      notification.monitor_id,
      notification.event_type,
      notification.target_url,
      notification.status,
      notification.response_status,
      notification.error,
      notification.sent_at
    ).run();
    await db.prepare(
      `UPDATE alert_incidents
       SET notification_count = notification_count + 1
       WHERE id = ?`
    ).bind(incident.id).run();
    return notification;
  });
}

function deliverWebhook(
  fetcher: AlertFetch,
  config: AlertDeliveryConfig,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string
): Effect.Effect<{ status: string; responseStatus?: number; error?: string }, never> {
  if (!config.webhookUrl) {
    return Effect.succeed({ status: "skipped" });
  }

  return Effect.tryPromise({
    try: async () => {
      const response = await fetcher(config.webhookUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.webhookSecret ? { "X-Pulsemon-Alert-Secret": config.webhookSecret } : {}),
        },
        body: JSON.stringify({
          event_type: eventType,
          incident,
          evaluation,
        }),
      });

      return response.ok
        ? { status: "sent", responseStatus: response.status }
        : { status: "failed", responseStatus: response.status, error: await response.text() };
    },
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) => Effect.succeed({ status: "failed", error: messageFromUnknown(error) }))
  );
}

function postJson(
  fetcher: AlertFetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Effect.Effect<{ status: string; responseStatus?: number; error?: string }, never> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });

      return response.ok
        ? { status: "sent", responseStatus: response.status }
        : { status: "failed", responseStatus: response.status, error: await response.text() };
    },
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) => Effect.succeed({ status: "failed", error: messageFromUnknown(error) }))
  );
}

function alertTitle(incident: AlertIncident, eventType: string) {
  return eventType === "resolved"
    ? `Resolved: ${incident.name}`
    : `Alert: ${incident.name}`;
}

function alertSummary(incident: AlertIncident, evaluation: MonitorEvaluation, eventType: string) {
  const value = evaluation.value === null ? "no data" : String(Number(evaluation.value.toFixed(3)));
  return `${alertTitle(incident, eventType)} (${value} / threshold ${evaluation.threshold})`;
}

function deliverSlack(
  fetcher: AlertFetch,
  url: string,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string
) {
  const emoji = eventType === "resolved" ? ":white_check_mark:" : ":rotating_light:";
  return postJson(fetcher, url, {
    text: `${emoji} ${alertSummary(incident, evaluation, eventType)}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${alertTitle(incident, eventType)}*\n${evaluation.description}`,
        },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `Monitor \`${incident.monitor_id}\` · value ${evaluation.value ?? "no data"} · threshold ${evaluation.threshold}`,
        }],
      },
    ],
  });
}

function deliverPagerDuty(
  fetcher: AlertFetch,
  routingKey: string,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string
) {
  return postJson(fetcher, "https://events.pagerduty.com/v2/enqueue", {
    routing_key: routingKey,
    event_action: eventType === "resolved" ? "resolve" : "trigger",
    dedup_key: incident.id,
    payload: eventType === "resolved"
      ? undefined
      : {
          summary: alertSummary(incident, evaluation, eventType),
          source: "pulsemon",
          severity: "error",
          component: incident.monitor_id,
          group: incident.project_id,
          class: "monitor",
          custom_details: {
            incident,
            evaluation,
          },
        },
  });
}

function deliverEmailWebhook(
  fetcher: AlertFetch,
  url: string,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string
) {
  return postJson(fetcher, url, {
    subject: alertTitle(incident, eventType),
    text: alertSummary(incident, evaluation, eventType),
    event_type: eventType,
    incident,
    evaluation,
  });
}

function deliveryTargets(
  fetcher: AlertFetch,
  config: AlertDeliveryConfig,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string
): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];

  if (config.webhookUrl) {
    targets.push({
      channel: "webhook",
      url: config.webhookUrl,
      send: () => deliverWebhook(fetcher, config, incident, evaluation, eventType),
    });
  }
  if (config.slackWebhookUrl) {
    targets.push({
      channel: "slack",
      url: config.slackWebhookUrl,
      send: () => deliverSlack(fetcher, config.slackWebhookUrl!, incident, evaluation, eventType),
    });
  }
  if (config.pagerDutyRoutingKey) {
    targets.push({
      channel: "pagerduty",
      url: "https://events.pagerduty.com/v2/enqueue",
      send: () => deliverPagerDuty(fetcher, config.pagerDutyRoutingKey!, incident, evaluation, eventType),
    });
  }
  if (config.emailWebhookUrl) {
    targets.push({
      channel: "email",
      url: config.emailWebhookUrl,
      send: () => deliverEmailWebhook(fetcher, config.emailWebhookUrl!, incident, evaluation, eventType),
    });
  }

  if (targets.length === 0) {
    targets.push({
      channel: "none",
      send: () => Effect.succeed({ status: "skipped" }),
    });
  }

  return targets;
}

function notify(
  db: D1Database,
  tenant: TenantScope,
  fetcher: AlertFetch,
  config: AlertDeliveryConfig,
  incident: AlertIncident,
  evaluation: MonitorEvaluation,
  eventType: string,
  sentAt: string
): Effect.Effect<number, DatabaseError> {
  return Effect.gen(function* () {
    const targets = deliveryTargets(fetcher, config, incident, evaluation, eventType);
    for (const target of targets) {
      const delivery = yield* target.send();
      yield* recordNotification(db, tenant, incident, eventType, target.channel, target.url, sentAt, delivery);
    }
    return targets.length;
  });
}

export function processMonitorAlerts(
  db: D1Database,
  tenant: TenantScope,
  evaluations: readonly MonitorEvaluation[],
  config: AlertDeliveryConfig,
  fetcher: AlertFetch = fetch
): Effect.Effect<AlertProcessingResult, DatabaseError> {
  return Effect.gen(function* () {
    let opened = 0;
    let resolved = 0;
    let notifications = 0;

    for (const evaluation of evaluations) {
      const active = yield* getActiveIncident(db, tenant, evaluation.monitor_id);
      const timestamp = evaluation.evaluated_at || nowIso();

      if (evaluation.status === "alert") {
        if (active) {
          yield* updateIncident(db, active, evaluation, timestamp);
        } else {
          const incident = yield* openIncident(db, tenant, evaluation, timestamp);
          notifications += yield* notify(db, tenant, fetcher, config, incident, evaluation, "opened", timestamp);
          opened += 1;
        }
      } else if (active && evaluation.status === "ok") {
        const incident = yield* resolveIncident(db, active, evaluation, timestamp);
        notifications += yield* notify(db, tenant, fetcher, config, incident, evaluation, "resolved", timestamp);
        resolved += 1;
      }
    }

    return { opened, resolved, notifications };
  });
}

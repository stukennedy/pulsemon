import { Effect } from "effect";
import type { Connection, Event, LogRecord, Metric, Span } from "@/db/schema";
import type { ActiveTag, TenantScope } from "@/types";
import { DEFAULT_TENANT_SCOPE } from "@/lib/tenant";
import {
  getConnectionDetail as getConnectionDetailFromD1,
  getConnectionFacetValues as getConnectionFacetValuesFromD1,
  getLogFacetValues as getLogFacetValuesFromD1,
  getMetricFacetValues as getMetricFacetValuesFromD1,
  getSpanFacetValues as getSpanFacetValuesFromD1,
  getTraceSpans as getTraceSpansFromD1,
  queryConnections as queryConnectionsFromD1,
  queryLogs as queryLogsFromD1,
  queryMetrics as queryMetricsFromD1,
  queryMetricSummaries as queryMetricSummariesFromD1,
  querySpans as querySpansFromD1,
  type MetricSummary,
} from "@/lib/facets";
import {
  queryConnectionStats as queryConnectionStatsFromD1,
  queryDashboardStats as queryDashboardStatsFromD1,
  type ConnectionStats,
  type DashboardStats,
} from "@/lib/stats";
import {
  DatabaseError,
  ValidationError,
  type QueryError,
} from "./errors";

export interface Pagination {
  readonly limit?: number;
  readonly offset?: number;
}

export interface NormalizedPagination {
  readonly limit: number;
  readonly offset: number;
}

export interface ConnectionQueryResult {
  readonly connections: Connection[];
  readonly total: number;
}

export interface SpanQueryResult {
  readonly spans: Span[];
  readonly total: number;
}

export interface LogQueryResult {
  readonly logs: LogRecord[];
  readonly total: number;
}

export interface MetricQueryResult {
  readonly metrics: Metric[];
  readonly total: number;
}

export interface MetricOverviewResult extends MetricQueryResult {
  readonly summaries: MetricSummary[];
}

export interface ConnectionDetailResult {
  readonly connection: Connection | null;
  readonly events: Event[];
  readonly spans: Span[];
}

export interface TelemetryQueryRepository {
  readonly queryConnections: (
    activeTags: readonly ActiveTag[],
    pagination: NormalizedPagination
  ) => Effect.Effect<ConnectionQueryResult, DatabaseError>;
  readonly getConnectionDetail: (connectionId: string) => Effect.Effect<ConnectionDetailResult, DatabaseError>;
  readonly querySpans: (
    activeTags: readonly ActiveTag[],
    pagination: Pick<NormalizedPagination, "limit">
  ) => Effect.Effect<SpanQueryResult, DatabaseError>;
  readonly queryLogs: (
    activeTags: readonly ActiveTag[],
    pagination: NormalizedPagination
  ) => Effect.Effect<LogQueryResult, DatabaseError>;
  readonly queryMetrics: (
    activeTags: readonly ActiveTag[],
    pagination: NormalizedPagination
  ) => Effect.Effect<MetricQueryResult, DatabaseError>;
  readonly queryMetricSummaries: (activeTags: readonly ActiveTag[]) => Effect.Effect<MetricSummary[], DatabaseError>;
  readonly getTraceSpans: (traceId: string) => Effect.Effect<Span[], DatabaseError>;
  readonly getConnectionFacetValues: (
    facet: string,
    prefix: string,
    activeTags: readonly ActiveTag[]
  ) => Effect.Effect<string[], DatabaseError>;
  readonly getSpanFacetValues: (
    facet: string,
    prefix: string,
    activeTags: readonly ActiveTag[]
  ) => Effect.Effect<string[], DatabaseError>;
  readonly getLogFacetValues: (
    facet: string,
    prefix: string,
    activeTags: readonly ActiveTag[]
  ) => Effect.Effect<string[], DatabaseError>;
  readonly getMetricFacetValues: (
    facet: string,
    prefix: string,
    activeTags: readonly ActiveTag[]
  ) => Effect.Effect<string[], DatabaseError>;
  readonly queryDashboardStats: () => Effect.Effect<DashboardStats, DatabaseError>;
  readonly queryConnectionStats: (activeTags: readonly ActiveTag[]) => Effect.Effect<ConnectionStats, DatabaseError>;
}

export interface QueryDeps {
  readonly repository: TelemetryQueryRepository;
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

function normalizePagination(
  pagination: Pagination,
  defaults: NormalizedPagination,
  maxLimit: number
): Effect.Effect<NormalizedPagination, ValidationError> {
  const limit = pagination.limit ?? defaults.limit;
  const offset = pagination.offset ?? defaults.offset;

  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return Effect.fail(new ValidationError({ message: `limit must be an integer between 1 and ${maxLimit}` }));
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return Effect.fail(new ValidationError({ message: "offset must be a non-negative integer" }));
  }

  return Effect.succeed({ limit, offset });
}

export function makeD1TelemetryQueryRepository(
  d1: D1Database,
  tenant: TenantScope = DEFAULT_TENANT_SCOPE
): TelemetryQueryRepository {
  return {
    queryConnections: (activeTags, pagination) => dbEffect(() =>
      queryConnectionsFromD1(d1, [...activeTags], pagination.limit, pagination.offset, tenant)
    ),

    getConnectionDetail: (connectionId) => dbEffect(() =>
      getConnectionDetailFromD1(d1, connectionId, tenant)
    ),

    querySpans: (activeTags, pagination) => dbEffect(() =>
      querySpansFromD1(d1, [...activeTags], pagination.limit, tenant)
    ),

    queryLogs: (activeTags, pagination) => dbEffect(() =>
      queryLogsFromD1(d1, [...activeTags], pagination.limit, pagination.offset, tenant)
    ),

    queryMetrics: (activeTags, pagination) => dbEffect(() =>
      queryMetricsFromD1(d1, [...activeTags], pagination.limit, pagination.offset, tenant)
    ),

    queryMetricSummaries: (activeTags) => dbEffect(() =>
      queryMetricSummariesFromD1(d1, [...activeTags], tenant)
    ),

    getTraceSpans: (traceId) => dbEffect(() =>
      getTraceSpansFromD1(d1, traceId, tenant)
    ),

    getConnectionFacetValues: (facet, prefix, activeTags) => dbEffect(() =>
      getConnectionFacetValuesFromD1(d1, facet, prefix, [...activeTags], tenant)
    ),

    getSpanFacetValues: (facet, prefix, activeTags) => dbEffect(() =>
      getSpanFacetValuesFromD1(d1, facet, prefix, [...activeTags], tenant)
    ),

    getLogFacetValues: (facet, prefix, activeTags) => dbEffect(() =>
      getLogFacetValuesFromD1(d1, facet, prefix, [...activeTags], tenant)
    ),

    getMetricFacetValues: (facet, prefix, activeTags) => dbEffect(() =>
      getMetricFacetValuesFromD1(d1, facet, prefix, [...activeTags], tenant)
    ),

    queryDashboardStats: () => dbEffect(() =>
      queryDashboardStatsFromD1(d1, tenant)
    ),

    queryConnectionStats: (activeTags) => dbEffect(() =>
      queryConnectionStatsFromD1(d1, [...activeTags], tenant)
    ),
  };
}

export function queryConnections(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[],
  pagination: Pagination = {}
): Effect.Effect<ConnectionQueryResult, QueryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizePagination(
      pagination,
      { limit: 100, offset: 0 },
      500
    );
    return yield* deps.repository.queryConnections(activeTags, normalized);
  });
}

export function getConnectionDetail(
  deps: QueryDeps,
  connectionId: string
): Effect.Effect<ConnectionDetailResult, QueryError> {
  return deps.repository.getConnectionDetail(connectionId);
}

export function querySpans(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[],
  pagination: Pagination = {}
): Effect.Effect<SpanQueryResult, QueryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizePagination(
      pagination,
      { limit: 100, offset: 0 },
      500
    );
    return yield* deps.repository.querySpans(activeTags, { limit: normalized.limit });
  });
}

export function queryLogs(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[],
  pagination: Pagination = {}
): Effect.Effect<LogQueryResult, QueryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizePagination(
      pagination,
      { limit: 100, offset: 0 },
      1000
    );
    return yield* deps.repository.queryLogs(activeTags, normalized);
  });
}

export function queryMetrics(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[],
  pagination: Pagination = {}
): Effect.Effect<MetricQueryResult, QueryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizePagination(
      pagination,
      { limit: 100, offset: 0 },
      1000
    );
    return yield* deps.repository.queryMetrics(activeTags, normalized);
  });
}

export function queryMetricOverview(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[],
  pagination: Pagination = {}
): Effect.Effect<MetricOverviewResult, QueryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizePagination(
      pagination,
      { limit: 100, offset: 0 },
      1000
    );
    const [metricResult, summaries] = yield* Effect.all([
      deps.repository.queryMetrics(activeTags, normalized),
      deps.repository.queryMetricSummaries(activeTags),
    ], { concurrency: "unbounded" });
    return { ...metricResult, summaries };
  });
}

export function getTraceSpans(
  deps: QueryDeps,
  traceId: string
): Effect.Effect<Span[], QueryError> {
  return deps.repository.getTraceSpans(traceId);
}

export function getConnectionFacetValues(
  deps: QueryDeps,
  facet: string,
  prefix: string,
  activeTags: readonly ActiveTag[]
): Effect.Effect<string[], QueryError> {
  return deps.repository.getConnectionFacetValues(facet, prefix, activeTags);
}

export function getSpanFacetValues(
  deps: QueryDeps,
  facet: string,
  prefix: string,
  activeTags: readonly ActiveTag[]
): Effect.Effect<string[], QueryError> {
  return deps.repository.getSpanFacetValues(facet, prefix, activeTags);
}

export function getLogFacetValues(
  deps: QueryDeps,
  facet: string,
  prefix: string,
  activeTags: readonly ActiveTag[]
): Effect.Effect<string[], QueryError> {
  return deps.repository.getLogFacetValues(facet, prefix, activeTags);
}

export function getMetricFacetValues(
  deps: QueryDeps,
  facet: string,
  prefix: string,
  activeTags: readonly ActiveTag[]
): Effect.Effect<string[], QueryError> {
  return deps.repository.getMetricFacetValues(facet, prefix, activeTags);
}

export function queryDashboardStats(
  deps: QueryDeps
): Effect.Effect<DashboardStats, QueryError> {
  return deps.repository.queryDashboardStats();
}

export function queryConnectionStats(
  deps: QueryDeps,
  activeTags: readonly ActiveTag[]
): Effect.Effect<ConnectionStats, QueryError> {
  return deps.repository.queryConnectionStats(activeTags);
}

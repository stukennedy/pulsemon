
import { Hono, Env } from 'hono';

import * as api_connections from './routes/api/connections';
import * as api_logs from './routes/api/logs';
import * as api_metrics from './routes/api/metrics';
import * as api_traces from './routes/api/traces';
import * as api_admin_maintenance from './routes/api/admin/maintenance';
import * as ingest from './routes/api/ingest';
import * as connections_id from './routes/connections/[id]';
import * as traces_id from './routes/traces/[id]';
import * as connections_index from './routes/connections';
import * as logs_index from './routes/logs';
import * as metrics_index from './routes/metrics';
import * as traces_index from './routes/traces';
import * as voice from './routes/voice';
import * as ws from './routes/ws';
import * as index from './routes';

export const loadRoutes = <T extends Env>(app: Hono<T>) => {
	// UI read APIs
	app.get('/api/connections', api_connections.onRequestGet);
	app.get('/api/logs', api_logs.onRequestGet);
	app.get('/api/metrics', api_metrics.onRequestGet);
	app.get('/api/traces', api_traces.onRequestGet);
	app.post('/api/admin/maintenance', api_admin_maintenance.onRequestPost);

	// Ingest API (authenticated)
	app.post('/api/ingest/connections', ingest.postConnections);
	app.patch('/api/ingest/connections/:id', ingest.patchConnection);
	app.post('/api/ingest/spans', ingest.postSpans);
	app.patch('/api/ingest/spans/:id', ingest.patchSpan);
	app.post('/api/ingest/events', ingest.postEvents);
	app.post('/api/ingest/metrics', ingest.postMetrics);
	app.post('/api/ingest/logs', ingest.postLogs);
	app.post('/api/ingest/voice/turns', ingest.postVoiceTurns);
	app.post('/api/ingest/agent/tool-calls', ingest.postAgentToolCalls);
	app.post('/api/ingest/batch', ingest.postBatch);
	app.post('/api/ingest/otlp/v1/traces', ingest.postOtlpTraces);
	app.post('/api/ingest/otlp/v1/metrics', ingest.postOtlpMetrics);
	app.post('/api/ingest/otlp/v1/logs', ingest.postOtlpLogs);

	// Pages
	app.get('/connections/:id', connections_id.onRequestGet);
	app.get('/traces/:id', traces_id.onRequestGet);
	app.get('/connections', connections_index.onRequestGet);
	app.get('/logs', logs_index.onRequestGet);
	app.get('/metrics', metrics_index.onRequestGet);
	app.get('/traces', traces_index.onRequestGet);
	app.get('/voice', voice.onRequestGet);
	app.get('/ws', ws.onRequestGet);
	app.get('/', index.onRequestGet);
};

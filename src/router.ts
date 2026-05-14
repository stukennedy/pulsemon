
import { Hono, Env } from 'hono';

import * as api_connections from './routes/api/connections';
import * as api_logs from './routes/api/logs';
import * as api_traces from './routes/api/traces';
import * as ingest from './routes/api/ingest';
import * as connections_id from './routes/connections/[id]';
import * as traces_id from './routes/traces/[id]';
import * as connections_index from './routes/connections';
import * as logs_index from './routes/logs';
import * as traces_index from './routes/traces';
import * as voice from './routes/voice';
import * as ws from './routes/ws';
import * as index from './routes';

export const loadRoutes = <T extends Env>(app: Hono<T>) => {
	// UI read APIs
	app.get('/api/connections', api_connections.onRequestGet);
	app.get('/api/logs', api_logs.onRequestGet);
	app.get('/api/traces', api_traces.onRequestGet);

	// Ingest API (authenticated)
	app.post('/api/ingest/connections', ingest.postConnections);
	app.patch('/api/ingest/connections/:id', ingest.patchConnection);
	app.post('/api/ingest/spans', ingest.postSpans);
	app.patch('/api/ingest/spans/:id', ingest.patchSpan);
	app.post('/api/ingest/events', ingest.postEvents);
	app.post('/api/ingest/metrics', ingest.postMetrics);
	app.post('/api/ingest/logs', ingest.postLogs);
	app.post('/api/ingest/batch', ingest.postBatch);

	// Pages
	app.get('/connections/:id', connections_id.onRequestGet);
	app.get('/traces/:id', traces_id.onRequestGet);
	app.get('/connections', connections_index.onRequestGet);
	app.get('/logs', logs_index.onRequestGet);
	app.get('/traces', traces_index.onRequestGet);
	app.get('/voice', voice.onRequestGet);
	app.get('/ws', ws.onRequestGet);
	app.get('/', index.onRequestGet);
};

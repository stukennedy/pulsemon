# pulsemon-client

The ingest client for Pulsemon, living beside the receiver it speaks to (`../../src`).
Buffered, best-effort, content-free by default; one `POST /api/ingest/batch` per flush.
Invariants and the wire contract: [AGENTS.md](AGENTS.md).

```ts
import { createPulsemonClient } from 'pulsemon-client';

const pulsemon = createPulsemonClient(env); // PULSEMON_INGEST_URL + PULSEMON_INGEST_KEY, or a no-op
pulsemon.span({ traceId, service: 'voice-gateway', operation: 'GET /scan/:id', durationMs: 12 });
ctx.waitUntil(pulsemon.flush());
```

## Tests

The receiver's test suite drives this package (built, from the workspace) through
`/api/ingest/batch` on every run: `src/test/contract/`. A field rename on either
side fails there before it ships.

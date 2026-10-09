# pulsemon-client

Transport for [Pulsemon](https://github.com/stukennedy/pulsemon), a realtime-app
observability platform (connections, spans, `voice_turns`, `agent_tool_calls`,
logs, metrics, SLO monitors) deployed as its own Worker per environment.

The client lives beside the receiver, so one change can update both ends of the wire.

## Purpose & boundary

**This package is a transport and nothing else.** It buffers records and POSTs
them to Pulsemon's `/api/ingest/batch`. It has no opinion about what is worth
observing — the emitters decide that.

- **It knows nothing about the platform — or the receiver.** No Worker bindings,
  no Hono context, no DO storage, and no import from `../../src` even though it
  sits next to it: the receiver's schema is exercised through the contract test
  (`src/test/contract/`), never imported. `types: ["node"]` in `tsconfig.json` is
  the mechanical proof; keep it that way.
- **It is a second sink, not a replacement.** Console logging and any existing
  log pipeline stay; this package adds a network transport beside them and
  deliberately imports no logging package.
- **Consumers own correlation.** The DO or middleware that has the `callId`,
  `turnId` and `traceId` supplies them; this package never invents
  identity.

## Load-bearing invariants

**Content-free by default, enforced twice.** Pulsemon's ingest accepts
conversation content — `voice_turns.transcript`, `tool_calls.input`/`.output`.
This package strips `VoiceTurnInput.transcript` at buffer time unless the
client was created with `PULSEMON_CONTENT_CAPTURE: 'true'` (exact match), does
not expose tool payloads at all, and `scrubAttributes` drops any attribute
whose key names content or whose value is a non-scalar, because
`Record<string, Scalar>` still accepts `{ transcript }` and a caller spreading
a log's fields into attributes would leak silently. The gate lives in the
client, not the call sites, so a populated field cannot reach the wire on an
uncaptured environment. Turning capture on is a per-environment product and data-protection decision,
not a debugging convenience: enable it only where every user whose speech
could reach the wire is a known, consenting participant (internal test
traffic), never on an environment reachable by real end users. A capture flag
that outlives its purpose fails silently, since the wire just starts carrying
speech, so give each one an owner and a removal date.

**Inert without config.** No `PULSEMON_INGEST_URL` or no `PULSEMON_INGEST_KEY`
⇒ `createPulsemonClient` returns a no-op whose `enabled` is `false`. Not a
degraded mode, not a queue that grows — a surface with Pulsemon unconfigured
behaves exactly as it did before this package existed. Both, or nothing: a URL
without a key would 401 every flush forever.

**Never on the critical path.** Buffering never touches the network; `flush()`
is the only thing that does, it **always resolves** (an unhandled rejection
inside someone's `waitUntil` is a real failure mode), and callers hand it to
`waitUntil`. Buffers drain *before* the request, so a transport failure costs
one batch instead of growing a retry queue that outlives its request.

**One subrequest per flush.** Workers cap subrequests per invocation. A POST per
record would burn that budget and eventually fail real work, which is why
everything goes through the batch endpoint and why `MAX_BUFFERED` sheds the
oldest records rather than letting a caller who never flushes grow unbounded
inside a DO that is also holding a live call.

## Wire contract

Field names are Pulsemon's (snake_case), pinned against the receiver's
`src/lib/effect/schemas.ts` (`BatchInputSchema`) — now in this repo, so a schema
change and its client change ship in ONE PR, and `src/test/contract/` fails the
PR that ships only one side. `src/wire.ts` is the one file that names a wire
field; `src/types.ts` is the caller-facing shape.

```bash
bun run type-check     # package (node-typed) + tests (bun)
bun run test:run
bun run build          # dist/: bun build + tsc declarations
```

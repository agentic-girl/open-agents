# Session Handoff & Continuity Notes

Use this file (alongside [ARCHITECTURE.md](ARCHITECTURE.md) and [README.md](README.md)) to resume development on another machine—or hand directly to an AI coding assistant so it has 100% of our architectural context without repeating early detours.

---

## 1. Setup on a New Machine

```bash
git clone https://github.com/agentic-girl/open-agents.git
cd open-agents
pnpm install
cp .env.example .env   # Add ANTHROPIC_API_KEY=... (note: .env is gitignored, so copy your key over)
pnpm test              # Verify build + unit/integration suites
pnpm dev               # Vite HMR (:3000) + Hono API (:3001) — or `pnpm start` for single-port :3000
```

---

## 2. Project Goal & Core Philosophy (Non-Negotiables)

- **Goal**: Build an opinionated, high-adoption open-source TypeScript agent runtime + turnkey UI (aiming for **LibreChat-level developer adoption**) that showcases production systems architecture.
- **Core Thesis**: Agentic AI is **not** a synchronous request/response CRUD web app, and stateful WebSockets are brittle for long-running agent runs.
- **Hard Architectural Rules**:
  1. **"Build Nothing Without a Harness" = Real Frontier Agent SDKs**:
     - Do **not** build DIY `while`-loops around raw LLM chat endpoints, fake `MockAgentHarness` demos, or unsolicited human-approval gates.
     - Delegate agent loops, context compaction, and file/bash/MCP execution to real frontier **Agent Harnesses**:
       - **`@open-agents/harness-claude`** (implemented): wraps official `@anthropic-ai/claude-agent-sdk` (`query()`), defaulting to **`claude-sonnet-5-5`** in **`bypassPermissions`** mode (`allowDangerouslySkipPermissions: true`).
       - Planned next: **`@open-agents/harness-copilot`** (`@github/copilot-sdk`) and **`@open-agents/harness-codex`** (`codex app-server`).
  2. **Discrete Completed Blocks Only (No Token-Delta Spam)**:
     - Harnesses run with `includePartialMessages: false`.
     - Every persisted item is a complete, authoritative `SessionBlock` (`user_message`, `thinking`, `tool_use`, `tool_result`, `assistant_message`, `turn_result`) with a strictly monotonic 1-indexed `seq` per session (~5–20 rows per turn).
     - Native multi-turn continuity is handled by storing `harnessSessionId` on `Session` and passing `resume: harnessSessionId` on subsequent turns.
  3. **Pull-Initiated Push ("Radio Broadcast" Transport, Zero WebSockets)**:
     - **Stateless backend**: HTTP API tracks zero per-client state in RAM; clients pass `?after=<seq>`.
     - **Dumb frontends (unlimited simultaneous tabs/devices)**:
       - While `idle`: tabs poll lightweight `GET /api/sessions/:id/status` (`{ status, latestSeq }`) every ~1.5s. Zero held-open idle connections.
       - When behind (`latestSeq > localSeq`) or `status === 'running'`: tabs open `GET /api/sessions/:id/sync?after=<localSeq>` (NDJSON).
       - Server subscribes to `BroadcasterAdapter` *before* reading `getBlocksAfter(afterSeq)` (race-free handoff via `highWaterMark`), flushes missed blocks, streams live blocks if `running`, and **closes the HTTP response cleanly** the moment the turn ends (`{"type":"done",...}`).
  4. **Plug-and-Play Ports & Adapters Bedrock**:
     - `@open-agents/core` has **zero external runtime dependencies** and defines clean ports: `HarnessAdapter`, `StoreAdapter`, `BroadcasterAdapter`, and `TurnDispatcherAdapter`, plus the Web-Standard `createOpenAgentsHandler(engine)` (`Request -> Promise<Response>`).

---

## 3. What Is Already Built & Verified

| Layer | Location | Status |
|---|---|---|
| Core Engine & Ports | `packages/core` (`@open-agents/core`) | Done & tested (`engine.ts`, `ports.ts`, `http-handler.ts`, `MemoryStoreAdapter`, `InMemoryBroadcaster`, `InProcessTurnDispatcher`) |
| SQLite WAL Store | `packages/store-sqlite` (`@open-agents/store-sqlite`) | Done & tested (atomic `seq` watermarks, crash recovery of orphaned `running` sessions, `runtime_settings` table) |
| Claude Harness | `packages/harness-claude` (`@open-agents/harness-claude`) | Done & verified live across multi-turn `claude-sonnet-5-5` runs (`bypassPermissions`, isolated `workspaces/<sessionId>`, dynamic `resolveApiKey`) |
| Turnkey Server | `apps/server` (`@open-agents/server`) | Done & tested (Hono `/api/*`, zero-restart `/api/settings/credentials` with secret masking, single-port static SPA serving on `:3000`) |
| Turnkey Web UI | `apps/web` (`@open-agents/web`) | Done & verified in browser (ChatGPT-style dark UI, `?s=<sessionId>` URL sync, starter cards, `2nd receiver` multi-tab broadcast button, zero-restart API key modal) |
| Docker & CI | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` | Done (single-container non-root `node:22-bookworm-slim` image + GitHub Actions test & multi-arch GHCR publish) |

---

## 4. Next Up (Where We Left Off)

We just finished the **60-Second Quickstart** polish and mapped out the **Advanced / Enterprise ("For the Nerds")** + **Multi-Harness** roadmap. Pick which milestone to tackle next:

### Option A: Advanced / Enterprise Setup ("For the Nerds")
1. **Decoupled `ROLE=api` + `ROLE=worker` Postgres Stack (`@open-agents/postgres` + `docker-compose.prod.yml`)**:
   - Implement all three scale ports on plain PostgreSQL (zero Redis/Kafka required to horizontally scale):
     - `PostgresStoreAdapter` (`sessions`, `session_blocks`, `runtime_settings`)
     - `PostgresQueueDispatcher` (`SELECT ... FOR UPDATE SKIP LOCKED` durable job queue + cross-pod `abort` notifications)
     - `PostgresNotifyBroadcaster` (`LISTEN / NOTIFY` so any sandboxed Worker pod wakes any stateless API pod's open `/sync` streams)
   - Add `ROLE=all | api | worker` mode in `apps/server` and `docker-compose.prod.yml` (`postgres` + stateless `api` replicas + sandboxed `worker` replicas sharing workspace/session storage).
2. **Declarative `open-agents.yaml` Config (The LibreChat Playbook)**:
   - Optional mounted config file allowing ops teams to preconfigure:
     - **MCP servers** (`stdio` / `sse` / `http`) passed straight into harness adapters
     - **Named Agent Presets** (`systemPrompt`, `model`, `allowedTools`, `maxTurns`, custom mounted `cwd`)
     - **Gateway Auth** (Bearer token or trusted reverse-proxy SSO headers like Tailscale / Cloudflare Access / OAuth2-Proxy)

### Option B: Next Frontier Harness Adapters
1. **`@open-agents/harness-copilot`**: Implement `HarnessAdapter` wrapping `@github/copilot-sdk` (`CopilotClient`, `approveAll`, discrete block mapping + session continuity).
2. **`@open-agents/harness-codex`**: Implement `HarnessAdapter` wrapping OpenAI `codex app-server` (JSON-RPC 2.0 turns/items mapped to `SessionBlock`s).

---

## 5. Prompt to Resume in a Fresh AI Session

> Read `ARCHITECTURE.md`, `README.md`, and `SESSION_NOTES.md` to get full context on OpenAgents—pay strict attention to the architectural non-negotiables in `SESSION_NOTES.md`. Verify `pnpm test` passes, then let's pick up from Section 4 ("Next Up").

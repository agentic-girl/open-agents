<div align="center">

# OpenAgents

**An opinionated, durable TypeScript runtime and turnkey UI built on frontier Agent Harnesses.**

[![CI](https://github.com/agentic-girl/open-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/agentic-girl/open-agents/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-Stateless_API-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)

</div>

---

## 60-Second Quickstart

### 1. Run the Turnkey Platform in One Command (Docker)

```bash
docker run -p 3000:3000 \
  -v open-agents-data:/data \
  -v open-agents-workspaces:/workspaces \
  ghcr.io/agentic-girl/open-agents:latest
```

Open **[http://localhost:3000](http://localhost:3000)**—even if you didn't pass `-e ANTHROPIC_API_KEY=...`, you can paste your key directly in the browser UI with **zero container restarts**, click a starter prompt, and click **2nd receiver** in the top bar to watch two browser tabs stream the live agent broadcast simultaneously.

*(Or run `docker compose up` from the repo root.)*

### 2. Run Locally (Reuses Existing `claude auth login` or `.env`)

If you already use Claude Code locally (`claude auth login`) or put `ANTHROPIC_API_KEY` in `.env`:

```bash
git clone https://github.com/agentic-girl/open-agents.git
cd open-agents
pnpm install
pnpm start      # Single-port UI + API on http://localhost:3000 (or `pnpm dev` for HMR)
```

---

## Embed in Your Own Codebase in 8 Lines

Every piece of OpenAgents is built as clean, decoupled TypeScript packages. `@open-agents/core` exports a zero-dependency Web-Standard `Request -> Promise<Response>` handler (`createOpenAgentsHandler`) that mounts directly into **Next.js App Router, Hono, Bun, Deno, or Node.js**:

```ts
import { createOpenAgentsHandler, OpenAgentsEngine } from '@open-agents/core';
import { ClaudeHarnessAdapter } from '@open-agents/harness-claude';
import { SqliteStoreAdapter } from '@open-agents/store-sqlite';

const engine = new OpenAgentsEngine({
  store: new SqliteStoreAdapter({ dbPath: './open-agents.db' }),
  harnesses: [new ClaudeHarnessAdapter({ defaultModel: 'claude-sonnet-5-5' })],
});

// Mount anywhere Web Fetch Request/Response is spoken (Next.js route.ts, Hono, Bun.serve):
const handler = createOpenAgentsHandler(engine, { basePath: '/api' });
```

---

## Why OpenAgents?

Most agent projects fail in production for two reasons:
1. **They treat agents like standard request/response CRUD apps** (or rely on fragile stateful WebSockets that drop when a laptop sleeps, a corporate proxy times out, or a container redeploys).
2. **They hand-roll DIY `while`-loops around raw LLM endpoints** instead of building on frontier **Agent Harnesses** that already solve context compaction, file/shell/MCP tools, and native session transcripts.

**OpenAgents takes three firm architectural stances:**
- **Harness-First**: Wraps official frontier agent harnesses—starting with **`@anthropic-ai/claude-agent-sdk`** (`claude-sonnet-5-5` in `bypassPermissions` mode), with **GitHub Copilot SDK** and **OpenAI Codex App Server** adapters planned next.
- **Pull-Initiated Push ("Radio Broadcast" Transport)**: Zero WebSockets and zero idle open sockets. A stateless Hono backend writes discrete, completed agent blocks (`thinking`, `tool_use`, `tool_result`, `assistant_message`) to a monotonic log. Any number of "dumb" frontends—across browser tabs, phones, or teammates—tune in via `?after=<seq>`, catch up instantly from disk, stream live updates until the turn ends, and survive refreshes or disconnects with zero lost work.
- **Plug-and-Play Ports & Adapters**: `@open-agents/core` has zero external runtime dependencies. Storage (`SQLite` quickstart $\leftrightarrow$ `Postgres`), Harnesses (`Claude` $\leftrightarrow$ `Copilot` $\leftrightarrow$ `Codex`), and Job Dispatch (`In-Process` $\leftrightarrow$ `Redis / BullMQ`) are cleanly isolated packages.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full transport specification, race-free sequence watermarks, and adapter interfaces.

---

## Monorepo Packages

| Package | Description |
|---|---|
| `packages/core` (`@open-agents/core`) | Zero-dependency TypeScript ports, `OpenAgentsEngine`, and Web-Standard `createOpenAgentsHandler` |
| `packages/harness-claude` (`@open-agents/harness-claude`) | Official `@anthropic-ai/claude-agent-sdk` adapter (`claude-sonnet-5-5`, `bypassPermissions`, native `resume` multi-turn continuity) |
| `packages/store-sqlite` (`@open-agents/store-sqlite`) | Zero-config SQLite WAL `StoreAdapter` + runtime settings persistence |
| `apps/server` (`@open-agents/server`) | Single-port turnkey Hono server (serves `/api/*` + static SPA + zero-restart credential setup) |
| `apps/web` (`@open-agents/web`) | Turnkey ChatGPT-style React + Tailwind broadcast receiver UI |

---

## Roadmap

- [x] `@open-agents/core` hexagonal ports + Web-Standard `createOpenAgentsHandler`
- [x] `@open-agents/harness-claude` (`@anthropic-ai/claude-agent-sdk`, `claude-sonnet-5-5`, `bypassPermissions`, multi-turn `resume`)
- [x] `@open-agents/store-sqlite` (WAL mode, atomic sequence watermarks, zero-restart credential store)
- [x] Single-port turnkey Hono server + single-image `Dockerfile` + GitHub Actions multi-arch GHCR pipeline
- [x] Turnkey ChatGPT-style React UI with starter cards, zero-restart key modal, and 1-click 2nd receiver tab
- [ ] `@open-agents/harness-copilot` (`@github/copilot-sdk`)
- [ ] `@open-agents/harness-codex` (`codex app-server` JSON-RPC)
- [ ] `@open-agents/store-postgres` + `LISTEN/NOTIFY` & distributed queue adapter

---

## License

[MIT](LICENSE)

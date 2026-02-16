# decision-log

> **Status: Experimental.** This plugin has an automated test suite but has barely been tested in real Claude Code sessions. Expect rough edges.

A Claude Code plugin that logs decisions and problem-solving approaches to disk so they survive context compaction.

## Why

When Claude Code compacts context, it loses the details of what was tried and decided during the session. This plugin provides MCP tools to record that information as it happens, and hooks that inject it back into context before and after compaction.

**Decisions** persist across the lifetime of the project — every session can search decisions from prior sessions.

**Problems** track the approaches tried during a session. When a problem is opened, every failed and successful approach is logged. This prevents retrying dead ends after compaction wipes the conversation history.

## Tools

| Tool | Purpose |
|------|---------|
| `log_decision` | Record a decision with options considered and rationale |
| `search_decisions` | Search project decisions across all sessions by keyword or tags |
| `open_problem` | Start tracking approaches to a problem |
| `log_approach` | Record a failed or successful approach to an open problem |
| `close_problem` | Mark a problem as solved with a resolution summary |
| `list_problems` | List problems in the current session, optionally filtered by status |
| `get_context` | Reload all session state (decisions + problems) after compaction |

## Hooks

- **PreCompact** — Injects a summary of open problems (with full approach history), resolved problems (summarized), and session decisions into the compacted context.
- **SessionStart** — Notifies Claude that prior project decisions exist and can be queried.

## Storage

Data is stored as JSON files under `~/.claude/decision-log/<project-slug>/`:

```
~/.claude/decision-log/
  <project-slug>/
    decisions.json              # project-lifetime decisions
    sessions/
      <session-uuid>/
        metadata.json           # session info (cwd, timestamps)
        problems.json           # session-scoped problems + approaches
```

The project slug is a 12-char SHA-256 hash of the git remote URL (falling back to cwd if not a git repo).

## Install

### Local testing

```bash
claude --plugin-dir /path/to/cc-plugin-decision-log
```

### From a plugin marketplace

Add the repository URL to your marketplace configuration. See [Claude Code plugin docs](https://docs.claude.com/en/docs/claude-code/plugins) for details.

## Development

```bash
cd server
npm install
npm run build    # tsc
npm test         # 35 tests across integration, hooks, edge cases, and E2E workflows
```

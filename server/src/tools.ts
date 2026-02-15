import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Storage } from './storage.js';
import type { Decision, Investigation } from './types.js';

const OptionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export function registerTools(server: McpServer, storage: Storage, sessionId: string) {
  server.tool(
    'log_decision',
    'Record a decision with options considered and rationale. Use this when you choose between approaches.',
    {
      topic: z.string().describe('What the decision is about'),
      options: z.array(OptionSchema).describe('Options that were considered'),
      chosen: z.string().describe('Which option was chosen'),
      rationale: z.string().describe('Why this option was chosen'),
      tags: z.array(z.string()).optional().describe('Tags for categorization (e.g. "auth", "architecture")'),
    },
    async (args) => {
      const decision: Decision = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        topic: args.topic,
        options: args.options,
        chosen: args.chosen,
        rationale: args.rationale,
        tags: args.tags ?? [],
      };
      storage.addDecision(decision);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Decision logged: "${args.topic}" → ${args.chosen}`,
          },
        ],
      };
    }
  );

  server.tool(
    'start_investigation',
    'Start tracking a problem you are investigating. Returns an investigation ID to use with log_attempt.',
    {
      problem: z.string().describe('Description of the problem being investigated'),
    },
    async (args) => {
      const investigation: Investigation = {
        id: randomUUID(),
        session_id: sessionId,
        problem: args.problem,
        status: 'open',
        created_at: new Date().toISOString(),
        attempts: [],
      };
      storage.addInvestigation(investigation);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Investigation started: "${args.problem}"\nID: ${investigation.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    'log_attempt',
    'Log a failed or succeeded approach to an open investigation.',
    {
      investigation_id: z.string().describe('ID from start_investigation'),
      approach: z.string().describe('What approach was tried'),
      outcome: z.enum(['failed', 'succeeded']).describe('Whether the approach failed or succeeded'),
      details: z.string().describe('What happened — error messages, why it failed, what worked'),
    },
    async (args) => {
      const inv = storage.updateInvestigation(args.investigation_id, (inv) => {
        inv.attempts.push({
          approach: args.approach,
          outcome: args.outcome,
          details: args.details,
          timestamp: new Date().toISOString(),
        });
      });
      if (!inv) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Investigation not found: ${args.investigation_id}`,
            },
          ],
          isError: true,
        };
      }
      const label = args.outcome === 'failed' ? 'FAILED' : 'SUCCEEDED';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Attempt logged [${label}]: ${args.approach} (investigation: ${inv.problem})`,
          },
        ],
      };
    }
  );

  server.tool(
    'resolve_investigation',
    'Mark an investigation as resolved with a summary of what worked.',
    {
      investigation_id: z.string().describe('ID from start_investigation'),
      resolution: z.string().describe('Summary of the resolution — what finally worked and why'),
    },
    async (args) => {
      const inv = storage.updateInvestigation(args.investigation_id, (inv) => {
        inv.status = 'resolved';
        inv.resolution = args.resolution;
      });
      if (!inv) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Investigation not found: ${args.investigation_id}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Investigation resolved: "${inv.problem}"\nResolution: ${args.resolution}\nAttempts: ${inv.attempts.length} (${inv.attempts.filter((a) => a.outcome === 'failed').length} failed)`,
          },
        ],
      };
    }
  );

  server.tool(
    'get_session_context',
    'Get all session state — decisions made and investigations (open and resolved). Use after context compaction to reload working memory.',
    {},
    async () => {
      const decisions = storage.readDecisions().filter(
        (d) => d.session_id === sessionId
      );
      const investigations = storage.readInvestigations();

      const parts: string[] = [];

      if (investigations.length > 0) {
        parts.push('## Investigations\n');
        for (const inv of investigations) {
          const status = inv.status === 'open' ? 'OPEN' : 'RESOLVED';
          parts.push(`### [${status}] ${inv.problem}`);
          for (const a of inv.attempts) {
            const label = a.outcome === 'failed' ? 'FAILED' : 'SUCCEEDED';
            parts.push(`- ${label}: ${a.approach} — ${a.details}`);
          }
          if (inv.resolution) {
            parts.push(`- RESOLUTION: ${inv.resolution}`);
          }
          parts.push('');
        }
      }

      if (decisions.length > 0) {
        parts.push('## Decisions This Session\n');
        for (const d of decisions) {
          parts.push(`- **${d.topic}**: ${d.chosen} — ${d.rationale}`);
        }
        parts.push('');
      }

      const allDecisions = storage.readDecisions();
      const otherDecisions = allDecisions.length - decisions.length;
      if (otherDecisions > 0) {
        parts.push(
          `\n${otherDecisions} additional project decision(s) from prior sessions. Use search_decisions to query.`
        );
      }

      const text =
        parts.length > 0
          ? parts.join('\n')
          : 'No decisions or investigations recorded in this session yet.';

      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'list_investigations',
    'List all investigations in the current session, optionally filtered by status.',
    {
      status: z.enum(['open', 'resolved', 'all']).optional().describe('Filter by status (default: all)'),
    },
    async (args) => {
      let investigations = storage.readInvestigations();
      if (args.status && args.status !== 'all') {
        investigations = investigations.filter((i) => i.status === args.status);
      }

      if (investigations.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No investigations found.' }],
        };
      }

      const lines = investigations.map((inv) => {
        const status = inv.status === 'open' ? 'OPEN' : 'RESOLVED';
        const attemptCount = inv.attempts.length;
        const failCount = inv.attempts.filter((a) => a.outcome === 'failed').length;
        const summary = inv.resolution
          ? ` → ${inv.resolution}`
          : ` (${attemptCount} attempt${attemptCount !== 1 ? 's' : ''}, ${failCount} failed)`;
        return `- [${status}] ${inv.problem}${summary} [id: ${inv.id}]`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `${investigations.length} investigation(s):\n\n${lines.join('\n')}`,
        }],
      };
    }
  );

  server.tool(
    'search_decisions',
    'Search project decisions across all sessions by keyword or tags.',
    {
      query: z.string().optional().describe('Search text (matches topic, chosen option, rationale)'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
    },
    async (args) => {
      const results = storage.searchDecisions(args.query, args.tags);
      if (results.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No matching decisions found.' },
          ],
        };
      }
      const lines = results.map(
        (d) =>
          `- [${d.timestamp.slice(0, 10)}] **${d.topic}**: ${d.chosen} — ${d.rationale}${d.tags.length ? ` (tags: ${d.tags.join(', ')})` : ''}`
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} decision(s):\n\n${lines.join('\n')}`,
          },
        ],
      };
    }
  );
}

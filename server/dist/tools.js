import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const OptionSchema = z.object({
    name: z.string(),
    description: z.string(),
});
export function registerTools(server, storage, sessionId) {
    server.tool('log_decision', 'Record a project-level decision with options considered and rationale. Use this when you choose between approaches, pick a library, settle an architectural question, or make any choice that future sessions should know about. Decisions persist across sessions.', {
        topic: z.string().describe('What the decision is about'),
        options: z.array(OptionSchema).describe('Options that were considered'),
        chosen: z.string().describe('Which option was chosen'),
        rationale: z.string().describe('Why this option was chosen'),
        tags: z
            .array(z.string())
            .optional()
            .describe('Tags for categorization (e.g. "auth", "architecture")'),
    }, async (args) => {
        const decision = {
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
                    type: 'text',
                    text: `Decision logged: "${args.topic}" → ${args.chosen}`,
                },
            ],
        };
    });
    server.tool('open_problem', 'Begin tracking approaches to a problem. Use this when you start debugging, investigating a failure, or working through a non-trivial issue. After opening a problem, log every approach you try with the decision-log log_approach tool — this prevents retrying dead ends after context compaction.', {
        problem: z
            .string()
            .describe('Description of the problem being investigated'),
    }, async (args) => {
        const problem = {
            id: randomUUID(),
            session_id: sessionId,
            problem: args.problem,
            status: 'open',
            created_at: new Date().toISOString(),
            approaches: [],
        };
        storage.addProblem(problem);
        return {
            content: [
                {
                    type: 'text',
                    text: `Problem opened: "${args.problem}"\nID: ${problem.id}`,
                },
            ],
        };
    });
    server.tool('log_approach', 'Record a failed or successful approach to an open problem. Call this after each attempt, before trying the next one. Logging failures is critical — they prevent retrying dead ends if context gets compacted. Include error messages, stack traces, and the specific reason for failure.', {
        problem_id: z.string().describe('ID returned by open_problem'),
        approach: z.string().describe('What approach was tried'),
        outcome: z
            .enum(['failed', 'succeeded'])
            .describe('Whether the approach failed or succeeded'),
        details: z
            .string()
            .describe('What happened — error messages, why it failed, what worked'),
    }, async (args) => {
        const p = storage.updateProblem(args.problem_id, (p) => {
            p.approaches.push({
                approach: args.approach,
                outcome: args.outcome,
                details: args.details,
                timestamp: new Date().toISOString(),
            });
        });
        if (!p) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Problem not found: ${args.problem_id}`,
                    },
                ],
                isError: true,
            };
        }
        const label = args.outcome === 'failed' ? 'FAILED' : 'SUCCEEDED';
        return {
            content: [
                {
                    type: 'text',
                    text: `Approach logged [${label}]: ${args.approach} (problem: ${p.problem})`,
                },
            ],
        };
    });
    server.tool('close_problem', 'Mark a problem as solved. Use this when you find the root cause or a working solution. Summarize what finally worked and why.', {
        problem_id: z.string().describe('ID returned by open_problem'),
        resolution: z
            .string()
            .describe('Summary of the resolution — what finally worked and why'),
    }, async (args) => {
        const p = storage.updateProblem(args.problem_id, (p) => {
            p.status = 'resolved';
            p.resolution = args.resolution;
        });
        if (!p) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Problem not found: ${args.problem_id}`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Problem closed: "${p.problem}"\nResolution: ${args.resolution}\nApproaches: ${p.approaches.length} (${p.approaches.filter((a) => a.outcome === 'failed').length} failed)`,
                },
            ],
        };
    });
    server.tool('get_context', 'Reload all session state — decisions, open problems with full approach history, and resolved problems. Call this after context compaction to restore your working memory. The PreCompact hook injects a summary automatically, but this tool gives you the complete picture.', {}, async () => {
        const decisions = storage
            .readDecisions()
            .filter((d) => d.session_id === sessionId);
        const problems = storage.readProblems();
        const parts = [];
        if (problems.length > 0) {
            parts.push('## Problems\n');
            for (const p of problems) {
                const status = p.status === 'open' ? 'OPEN' : 'RESOLVED';
                parts.push(`### [${status}] ${p.problem}`);
                for (const a of p.approaches) {
                    const label = a.outcome === 'failed' ? 'FAILED' : 'SUCCEEDED';
                    parts.push(`- ${label}: ${a.approach} — ${a.details}`);
                }
                if (p.resolution) {
                    parts.push(`- RESOLUTION: ${p.resolution}`);
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
            parts.push(`\n${otherDecisions} additional project decision(s) from prior sessions. Search them before making overlapping decisions.`);
        }
        const text = parts.length > 0
            ? parts.join('\n')
            : 'No decisions or problems recorded in this session yet.';
        return { content: [{ type: 'text', text }] };
    });
    server.tool('list_problems', 'List all problems in the current session, optionally filtered by status. Use this to check what problems are still open before starting new work or to get problem IDs.', {
        status: z
            .enum(['open', 'resolved', 'all'])
            .optional()
            .describe('Filter by status (default: all)'),
    }, async (args) => {
        let problems = storage.readProblems();
        if (args.status && args.status !== 'all') {
            problems = problems.filter((p) => p.status === args.status);
        }
        if (problems.length === 0) {
            return {
                content: [{ type: 'text', text: 'No problems found.' }],
            };
        }
        const lines = problems.map((p) => {
            const status = p.status === 'open' ? 'OPEN' : 'RESOLVED';
            const approachCount = p.approaches.length;
            const failCount = p.approaches.filter((a) => a.outcome === 'failed').length;
            const summary = p.resolution
                ? ` → ${p.resolution}`
                : ` (${approachCount} approach${approachCount !== 1 ? 'es' : ''}, ${failCount} failed)`;
            return `- [${status}] ${p.problem}${summary} [id: ${p.id}]`;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: `${problems.length} problem(s):\n\n${lines.join('\n')}`,
                },
            ],
        };
    });
    server.tool('search_decisions', 'Search project decisions across all sessions by keyword or tags. Use this before making a decision that might overlap with prior work, or when the SessionStart hook tells you prior decisions exist.', {
        query: z
            .string()
            .optional()
            .describe('Search text (matches topic, chosen option, rationale)'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
    }, async (args) => {
        const results = storage.searchDecisions(args.query, args.tags);
        if (results.length === 0) {
            return {
                content: [
                    { type: 'text', text: 'No matching decisions found.' },
                ],
            };
        }
        const lines = results.map((d) => `- [${d.timestamp.slice(0, 10)}] **${d.topic}**: ${d.chosen} — ${d.rationale}${d.tags.length ? ` (tags: ${d.tags.join(', ')})` : ''}`);
        return {
            content: [
                {
                    type: 'text',
                    text: `Found ${results.length} decision(s):\n\n${lines.join('\n')}`,
                },
            ],
        };
    });
}

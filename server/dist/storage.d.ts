import type { Decision, Problem } from './types.js';
export declare class Storage {
    private projectSlug;
    private sessionId;
    private projectDir;
    private sessionDir;
    constructor(cwd: string, sessionId: string);
    private ensureDirs;
    private writeMetadata;
    private decisionsPath;
    readDecisions(): Decision[];
    addDecision(decision: Decision): void;
    searchDecisions(query?: string, tags?: string[]): Decision[];
    private problemsPath;
    readProblems(): Problem[];
    private writeProblems;
    addProblem(problem: Problem): void;
    updateProblem(id: string, updater: (p: Problem) => void): Problem | null;
    getProblem(id: string): Problem | null;
}

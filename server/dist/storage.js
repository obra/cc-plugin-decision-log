import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectSlug, STORAGE_ROOT } from './project-slug.js';
export class Storage {
    projectSlug;
    sessionId;
    projectDir;
    sessionDir;
    constructor(cwd, sessionId) {
        this.projectSlug = getProjectSlug(cwd);
        this.sessionId = sessionId;
        this.projectDir = path.join(STORAGE_ROOT, this.projectSlug);
        this.sessionDir = path.join(this.projectDir, 'sessions', this.sessionId);
        this.ensureDirs();
        this.writeMetadata(cwd);
    }
    ensureDirs() {
        fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    writeMetadata(cwd) {
        const metaPath = path.join(this.sessionDir, 'metadata.json');
        if (fs.existsSync(metaPath))
            return;
        const meta = {
            session_id: this.sessionId,
            project_slug: this.projectSlug,
            cwd,
            started_at: new Date().toISOString(),
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
    // --- Decisions (project-level) ---
    decisionsPath() {
        return path.join(this.projectDir, 'decisions.json');
    }
    readDecisions() {
        try {
            return JSON.parse(fs.readFileSync(this.decisionsPath(), 'utf-8'));
        }
        catch {
            return [];
        }
    }
    addDecision(decision) {
        const decisions = this.readDecisions();
        decisions.push(decision);
        fs.writeFileSync(this.decisionsPath(), JSON.stringify(decisions, null, 2));
    }
    searchDecisions(query, tags) {
        const decisions = this.readDecisions();
        return decisions.filter((d) => {
            if (query) {
                const q = query.toLowerCase();
                const matches = d.topic.toLowerCase().includes(q) ||
                    d.chosen.toLowerCase().includes(q) ||
                    d.rationale.toLowerCase().includes(q) ||
                    d.options.some((o) => o.name.toLowerCase().includes(q) ||
                        o.description.toLowerCase().includes(q));
                if (!matches)
                    return false;
            }
            if (tags && tags.length > 0) {
                if (!tags.some((t) => d.tags.includes(t)))
                    return false;
            }
            return true;
        });
    }
    // --- Problems (session-level) ---
    problemsPath() {
        return path.join(this.sessionDir, 'problems.json');
    }
    readProblems() {
        try {
            return JSON.parse(fs.readFileSync(this.problemsPath(), 'utf-8'));
        }
        catch {
            return [];
        }
    }
    writeProblems(problems) {
        fs.writeFileSync(this.problemsPath(), JSON.stringify(problems, null, 2));
    }
    addProblem(problem) {
        const problems = this.readProblems();
        problems.push(problem);
        this.writeProblems(problems);
    }
    updateProblem(id, updater) {
        const problems = this.readProblems();
        const p = problems.find((p) => p.id === id);
        if (!p)
            return null;
        updater(p);
        this.writeProblems(problems);
        return p;
    }
    getProblem(id) {
        return this.readProblems().find((p) => p.id === id) ?? null;
    }
}

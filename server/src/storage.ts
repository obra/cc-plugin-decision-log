import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectSlug, STORAGE_ROOT } from './project-slug.js';
import type { Decision, Investigation, SessionMetadata } from './types.js';

export class Storage {
  private projectSlug: string;
  private sessionId: string;
  private projectDir: string;
  private sessionDir: string;

  constructor(cwd: string, sessionId: string) {
    this.projectSlug = getProjectSlug(cwd);
    this.sessionId = sessionId;
    this.projectDir = path.join(STORAGE_ROOT, this.projectSlug);
    this.sessionDir = path.join(this.projectDir, 'sessions', this.sessionId);
    this.ensureDirs();
    this.writeMetadata(cwd);
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  private writeMetadata(cwd: string): void {
    const metaPath = path.join(this.sessionDir, 'metadata.json');
    if (fs.existsSync(metaPath)) return;
    const meta: SessionMetadata = {
      session_id: this.sessionId,
      project_slug: this.projectSlug,
      cwd,
      started_at: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  // --- Decisions (project-level) ---

  private decisionsPath(): string {
    return path.join(this.projectDir, 'decisions.json');
  }

  readDecisions(): Decision[] {
    try {
      return JSON.parse(fs.readFileSync(this.decisionsPath(), 'utf-8'));
    } catch {
      return [];
    }
  }

  addDecision(decision: Decision): void {
    const decisions = this.readDecisions();
    decisions.push(decision);
    fs.writeFileSync(this.decisionsPath(), JSON.stringify(decisions, null, 2));
  }

  searchDecisions(query?: string, tags?: string[]): Decision[] {
    const decisions = this.readDecisions();
    return decisions.filter((d) => {
      if (query) {
        const q = query.toLowerCase();
        const matches =
          d.topic.toLowerCase().includes(q) ||
          d.chosen.toLowerCase().includes(q) ||
          d.rationale.toLowerCase().includes(q) ||
          d.options.some(
            (o) =>
              o.name.toLowerCase().includes(q) ||
              o.description.toLowerCase().includes(q)
          );
        if (!matches) return false;
      }
      if (tags && tags.length > 0) {
        if (!tags.some((t) => d.tags.includes(t))) return false;
      }
      return true;
    });
  }

  // --- Investigations (session-level) ---

  private investigationsPath(): string {
    return path.join(this.sessionDir, 'investigations.json');
  }

  readInvestigations(): Investigation[] {
    try {
      return JSON.parse(
        fs.readFileSync(this.investigationsPath(), 'utf-8')
      );
    } catch {
      return [];
    }
  }

  private writeInvestigations(investigations: Investigation[]): void {
    fs.writeFileSync(
      this.investigationsPath(),
      JSON.stringify(investigations, null, 2)
    );
  }

  addInvestigation(investigation: Investigation): void {
    const investigations = this.readInvestigations();
    investigations.push(investigation);
    this.writeInvestigations(investigations);
  }

  updateInvestigation(id: string, updater: (inv: Investigation) => void): Investigation | null {
    const investigations = this.readInvestigations();
    const inv = investigations.find((i) => i.id === id);
    if (!inv) return null;
    updater(inv);
    this.writeInvestigations(investigations);
    return inv;
  }

  getInvestigation(id: string): Investigation | null {
    return this.readInvestigations().find((i) => i.id === id) ?? null;
  }
}

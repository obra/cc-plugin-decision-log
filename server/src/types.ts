export interface Decision {
  id: string;
  timestamp: string;
  session_id: string;
  topic: string;
  options: Array<{ name: string; description: string }>;
  chosen: string;
  rationale: string;
  tags: string[];
}

export interface Attempt {
  approach: string;
  outcome: 'failed' | 'succeeded';
  details: string;
  timestamp: string;
}

export interface Investigation {
  id: string;
  session_id: string;
  problem: string;
  status: 'open' | 'resolved';
  created_at: string;
  attempts: Attempt[];
  resolution?: string;
}

export interface SessionMetadata {
  session_id: string;
  project_slug: string;
  cwd: string;
  started_at: string;
}

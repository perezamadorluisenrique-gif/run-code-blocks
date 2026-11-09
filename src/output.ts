// Turns a finished run into text. Pure.

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Exit code, or null when the process was killed or never started. */
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stopped: boolean;
  /** Characters of output that were not kept because of the output limit. */
  dropped?: number;
  /** Set when the program could not be started at all. */
  startError?: string;
  ms: number;
}

/** Keeps the first `max` characters and says how many were dropped. */
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, max)}\n… ${text.length - max} more characters not shown`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

/** One line under the output: how it ended. */
export function statusLine(r: RunResult): string {
  if (r.startError) return r.startError;
  const time = formatDuration(r.ms);
  if (r.timedOut) return `Stopped after ${time}: it ran past the time limit.`;
  if (r.stopped) return `Stopped after ${time}.`;
  if (r.code === 0) return `Done in ${time}.`;
  if (r.code === null) return `Ended by ${r.signal ?? 'a signal'} after ${time}.`;
  return `Exited with code ${r.code} after ${time}.`;
}

export function succeeded(r: RunResult): boolean {
  return !r.startError && !r.timedOut && !r.stopped && r.code === 0;
}

/** Plain text of stdout then stderr, the way a terminal would show it. */
export function combined(r: RunResult, max: number): string {
  const out = r.stdout.replace(/\s+$/, '');
  const err = r.stderr.replace(/\s+$/, '');
  const text = truncate([out, err].filter(Boolean).join('\n'), max);
  return r.dropped ? `${text}\n… ${r.dropped} more characters not shown` : text;
}

/** A friendlier line for the common "program not found" start error. */
export function explainStartError(command: string, code: string | undefined, message: string): string {
  if (code === 'ENOENT') return `Could not find "${command}". Install it or set its path in the plugin settings.`;
  return `Could not start "${command}": ${message}`;
}

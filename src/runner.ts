/// <reference types="node" />
// Runs code by writing it to a temp file and starting the language's
// program on it. Uses Node's child_process, so it only works on desktop.
import { spawn, spawnSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildCommand } from './languages.ts';
import type { Language } from './languages.ts';
import { explainStartError } from './output.ts';
import type { RunResult } from './output.ts';

// Popout windows have their own timers; plain Node (the tests) has none on window.
const timers = typeof window !== 'undefined' ? window : globalThis;

/**
 * Ends the program and everything it started. Killing only the shell would
 * leave a child such as `sleep` holding the output pipe open, so the run
 * would not end until that child did.
 */
function killTree(child: ChildProcess | null): void {
  if (!child || child.pid === undefined) return;
  try {
    // On POSIX the group outlives its leader, so signal it even after the shell exited.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export interface RunOptions {
  lang: Language;
  code: string;
  /** Working directory of the program. */
  cwd?: string;
  /** Replaces the program, e.g. "python3 -u". */
  override?: string;
  /** Seconds before the run is stopped; 0 means no limit. */
  timeoutSec: number;
  /** Characters of each stream kept in memory. */
  maxChars: number;
  platform?: string;
  /** Called with output as it arrives. */
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface Run {
  done: Promise<RunResult>;
  stop: () => void;
}

/** Starts a run. `done` always resolves; failures are in the result. */
export function startRun(opts: RunOptions): Run {
  const started = Date.now();
  let child: ChildProcess | null = null;
  let stopped = false;
  let timedOut = false;
  let tmp = '';

  const stop = () => {
    stopped = true;
    killTree(child);
  };

  const done = (async (): Promise<RunResult> => {
    const result: RunResult = { stdout: '', stderr: '', code: null, signal: null, timedOut: false, stopped: false, ms: 0 };
    try {
      tmp = await mkdtemp(join(tmpdir(), 'run-code-blocks-'));
      const file = join(tmp, `snippet${opts.lang.extension}`);
      await writeFile(file, opts.code, 'utf8');
      if (stopped) return { ...result, stopped: true, ms: Date.now() - started };
      const spec = buildCommand(opts.lang, file, opts.platform ?? process.platform, opts.override);
      return await new Promise<RunResult>((resolve) => {
        let timer: ReturnType<typeof timers.setTimeout> | undefined;
        const finish = (patch: Partial<RunResult>) => {
          if (timer) timers.clearTimeout(timer);
          resolve({ ...result, ...patch, timedOut, stopped: stopped && !timedOut, ms: Date.now() - started });
        };
        try {
          child = spawn(spec.command, spec.args, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          finish({ startError: explainStartError(spec.command, err.code, err.message) });
          return;
        }
        const keep = (stream: 'stdout' | 'stderr') => (text: string) => {
          opts.onData?.(text, stream);
          const room = Math.max(0, opts.maxChars - result[stream].length);
          result[stream] += text.slice(0, room);
          result.dropped = (result.dropped ?? 0) + Math.max(0, text.length - room);
        };
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', keep('stdout'));
        child.stderr?.on('data', keep('stderr'));
        child.on('error', (err: NodeJS.ErrnoException) => finish({ startError: explainStartError(spec.command, err.code, err.message) }));
        child.on('close', (code, signal) => finish({ code, signal }));
        if (opts.timeoutSec > 0) {
          timer = timers.setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, opts.timeoutSec * 1000);
        }
      });
    } catch (e) {
      return { ...result, startError: `Could not prepare the run: ${(e as Error).message}`, ms: Date.now() - started };
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  })();

  return { done, stop };
}

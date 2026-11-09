import test from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGES, buildCommand, languageFor } from '../src/languages.ts';
import { fenceAtLine, findFences, outputEdit } from '../src/fences.ts';
import { combined, explainStartError, formatDuration, statusLine, truncate } from '../src/output.ts';
import type { RunResult } from '../src/output.ts';

const base: RunResult = { stdout: '', stderr: '', code: 0, signal: null, timedOut: false, stopped: false, ms: 120 };

test('every alias is unique across languages', () => {
  const all = LANGUAGES.flatMap((l) => l.aliases);
  assert.equal(new Set(all).size, all.length);
});

test('languageFor ignores case and unknown names', () => {
  assert.equal(languageFor('JS')?.id, 'javascript');
  assert.equal(languageFor('Py')?.id, 'python');
  assert.equal(languageFor('cobol'), null);
  assert.equal(languageFor(''), null);
});

test('buildCommand uses the Windows program and honours overrides', () => {
  const py = languageFor('python')!;
  assert.deepEqual(buildCommand(py, 'a.py', 'linux'), { command: 'python3', args: ['a.py'] });
  assert.deepEqual(buildCommand(py, 'a.py', 'win32'), { command: 'python', args: ['a.py'] });
  assert.deepEqual(buildCommand(py, 'a.py', 'linux', '/opt/py/bin/python -u'), { command: '/opt/py/bin/python', args: ['-u', 'a.py'] });
  const go = languageFor('go')!;
  assert.deepEqual(buildCommand(go, 'm.go', 'linux'), { command: 'go', args: ['run', 'm.go'] });
});

const note = ['# T', '', '```js', 'console.log(1)', '```', '', '~~~python', 'print(2)', '~~~', 'tail'].join('\n');

test('findFences reads both fence styles', () => {
  const f = findFences(note);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].lang, f[0].code, f[0].startLine, f[0].endLine], ['js', 'console.log(1)', 2, 4]);
  assert.deepEqual([f[1].lang, f[1].code], ['python', 'print(2)']);
});

test('a longer fence is not closed by a shorter one', () => {
  const f = findFences('````md\n```js\nx\n```\n````');
  assert.equal(f.length, 1);
  assert.equal(f[0].code, '```js\nx\n```');
});

test('an unclosed fence runs to the end', () => {
  const f = findFences('```js\na\nb');
  assert.equal(f[0].code, 'a\nb');
});

test('fenceAtLine includes the fence lines and misses outside', () => {
  assert.equal(fenceAtLine(note, 2)?.lang, 'js');
  assert.equal(fenceAtLine(note, 4)?.lang, 'js');
  assert.equal(fenceAtLine(note, 5), null);
  assert.equal(fenceAtLine(note, 7)?.lang, 'python');
});

test('outputEdit inserts an output block after the fence', () => {
  const fence = findFences(note)[0];
  const e = outputEdit(note, fence, '1\n');
  assert.deepEqual(e, { fromLine: 5, toLine: 5, insert: '```output\n1\n```\n' });
});

test('outputEdit replaces an earlier output block', () => {
  const text = '```js\nx\n```\n```output\nold\n```\nafter';
  const e = outputEdit(text, findFences(text)[0], 'new');
  assert.deepEqual(e, { fromLine: 3, toLine: 6, insert: '```output\nnew\n```\n' });
});

test('outputEdit uses longer ticks when the output holds a fence', () => {
  const text = '```js\nx\n```\n';
  const e = outputEdit(text, findFences(text)[0], '```');
  assert.equal(e.insert, '````output\n```\n````\n');
});

test('truncate says how much it dropped', () => {
  assert.equal(truncate('abcdef', 0), 'abcdef');
  assert.equal(truncate('abcdef', 10), 'abcdef');
  assert.equal(truncate('abcdef', 3), 'abc\n… 3 more characters not shown');
});

test('formatDuration', () => {
  assert.equal(formatDuration(40), '40 ms');
  assert.equal(formatDuration(1500), '1.50 s');
  assert.equal(formatDuration(25000), '25.0 s');
});

test('statusLine covers every ending', () => {
  assert.equal(statusLine(base), 'Done in 120 ms.');
  assert.equal(statusLine({ ...base, code: 2 }), 'Exited with code 2 after 120 ms.');
  assert.equal(statusLine({ ...base, code: null, signal: 'SIGTERM' }), 'Ended by SIGTERM after 120 ms.');
  assert.match(statusLine({ ...base, timedOut: true, code: null }), /time limit/);
  assert.equal(statusLine({ ...base, stopped: true, code: null }), 'Stopped after 120 ms.');
  assert.equal(statusLine({ ...base, startError: 'boom' }), 'boom');
});

test('combined joins stdout and stderr and trims', () => {
  assert.equal(combined({ ...base, stdout: 'a\n', stderr: 'b\n\n' }, 100), 'a\nb');
  assert.equal(combined(base, 100), '');
});

test('explainStartError names the missing program', () => {
  assert.match(explainStartError('python3', 'ENOENT', 'x'), /Could not find "python3"/);
  assert.match(explainStartError('x', 'EACCES', 'denied'), /denied/);
});

import { startRun } from '../src/runner.ts';

const js = languageFor('js')!;
const common = { timeoutSec: 10, maxChars: 1000, platform: process.platform, override: process.execPath };

test('runner captures stdout and stderr and the exit code', async () => {
  const r = await startRun({ ...common, lang: js, code: 'console.log("hi"); console.error("oops"); process.exit(3)' }).done;
  assert.equal(r.stdout.trim(), 'hi');
  assert.equal(r.stderr.trim(), 'oops');
  assert.equal(r.code, 3);
});

test('runner stops a run that passes the time limit', async () => {
  const r = await startRun({ ...common, timeoutSec: 0.3, lang: js, code: 'setInterval(() => {}, 1000)' }).done;
  assert.equal(r.timedOut, true);
  assert.equal(r.stopped, false);
});

test('runner stop() ends a run and reports stopped', async () => {
  const run = startRun({ ...common, lang: js, code: 'console.log("x"); setInterval(() => {}, 1000)' });
  setTimeout(run.stop, 300);
  const r = await run.done;
  assert.equal(r.stopped, true);
});

test('runner reports a missing program', async () => {
  const r = await startRun({ ...common, override: 'definitely-not-installed-xyz', lang: js, code: '1' }).done;
  assert.match(r.startError ?? '', /Could not find/);
});

test('runner caps what it keeps', async () => {
  const r = await startRun({ ...common, maxChars: 10, lang: js, code: 'console.log("a".repeat(500))' }).done;
  assert.equal(r.stdout.length, 10);
});

test('a time limit also ends the programs the script started', { skip: process.platform === 'win32' }, async () => {
  const bash = languageFor('bash')!;
  const t = Date.now();
  const r = await startRun({ ...common, override: undefined, timeoutSec: 0.5, lang: bash, code: 'sleep 8\necho late' }).done;
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t < 4000, 'did not wait for the sleep to finish');
});

import { splitCommand } from '../src/languages.ts';

test('splitCommand keeps quoted paths together', () => {
  assert.deepEqual(splitCommand('python3 -u'), ['python3', '-u']);
  assert.deepEqual(splitCommand('"C:\\Program Files\\Python\\python.exe" -u'), ['C:\\Program Files\\Python\\python.exe', '-u']);
});

test('outputEdit appends after a closing fence that ends the note', () => {
  const text = '```js\n1\n```';
  const e = outputEdit(text, findFences(text)[0], 'x');
  assert.equal(e.atEnd, true);
  assert.equal(e.fromLine, 2);
  assert.equal(e.insert, '\n```output\nx\n```');
});

test('a background child left by the script is still stopped', { skip: process.platform === 'win32' }, async () => {
  const run = startRun({ ...common, override: undefined, timeoutSec: 0.5, lang: languageFor('bash')!, code: 'sleep 8 &\necho hi' });
  const t = Date.now();
  const r = await run.done;
  assert.ok(Date.now() - t < 4000);
  assert.equal(r.timedOut, true);
});

test('the dropped count is reported when output passes the limit', async () => {
  const r = await startRun({ ...common, maxChars: 10, lang: js, code: 'console.log("a".repeat(500))' }).done;
  assert.ok((r.dropped ?? 0) >= 490);
  assert.match(combined(r, 10), /more characters not shown/);
});

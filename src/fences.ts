// Finds fenced code blocks in a note's text. Pure, line based.

export interface Fence {
  /** The word after the opening backticks, as written. */
  lang: string;
  code: string;
  /** Line numbers (0-based) of the opening and closing fence lines. */
  startLine: number;
  endLine: number;
}

const OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;

/** Every closed fenced block in `text`. An unclosed block runs to the end. */
export function findFences(text: string): Fence[] {
  const lines = text.split('\n');
  const found: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) continue;
    const marker = open[2];
    const char = marker[0];
    let end = lines.length - 1;
    let closed = false;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.length >= marker.length && t.split('').every((c) => c === char)) {
        end = j;
        closed = true;
        break;
      }
    }
    found.push({
      lang: open[3],
      code: lines.slice(i + 1, closed ? end : lines.length).join('\n'),
      startLine: i,
      endLine: end,
    });
    i = end;
  }
  return found;
}

/** The block whose lines contain `line`, fence lines included. */
export function fenceAtLine(text: string, line: number): Fence | null {
  return findFences(text).find((f) => line >= f.startLine && line <= f.endLine) ?? null;
}

/** Fence names used for output blocks, so the plugin can replace its own. */
export const OUTPUT_LANG = 'output';

/**
 * Text that puts `output` in an ```output block right after `fence`,
 * replacing an output block already there. Returns the line range to
 * replace (`from` inclusive, `to` exclusive, in lines) and the new text.
 */
export function outputEdit(text: string, fence: Fence, output: string): { fromLine: number; toLine: number; insert: string; atEnd?: boolean } {
  const lines = text.split('\n');
  const next = fence.endLine + 1;
  const body = output.replace(/\s+$/, '');
  let ticks = '```';
  while (body.includes(ticks)) ticks += '`';
  const block = [`${ticks}${OUTPUT_LANG}`, ...(body ? body.split('\n') : []), ticks];
  // The closing fence is the last line and the note has no final newline: add after it.
  if (next >= lines.length) return { fromLine: fence.endLine, toLine: fence.endLine, insert: '\n' + block.join('\n'), atEnd: true };
  const existing = lines[next] !== undefined ? OPEN.exec(lines[next]) : null;
  if (existing && existing[3] === OUTPUT_LANG) {
    const old = findFences(lines.slice(next).join('\n'))[0];
    return { fromLine: next, toLine: next + old.endLine + 1, insert: block.join('\n') + '\n' };
  }
  return { fromLine: next, toLine: next, insert: block.join('\n') + '\n' };
}

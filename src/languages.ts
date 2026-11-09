// Which fence languages can run, and with which program. Pure: no `obsidian`
// and no Node imports, so tests/ can check every row under plain Node.

export interface Language {
  /** Canonical id, also the key of the per-language command override. */
  id: string;
  label: string;
  /** Fence names that map to this language, lower case. */
  aliases: string[];
  /** Program to start when the user has not set one. */
  command: string;
  /** Program on Windows when it differs (Python is `python` there). */
  windowsCommand?: string;
  /** Extension of the temp file the code is written to. */
  extension: string;
  /** Arguments placed before the file path. */
  args?: string[];
}

export const LANGUAGES: readonly Language[] = [
  { id: 'javascript', label: 'JavaScript', aliases: ['javascript', 'js', 'node'], command: 'node', extension: '.js' },
  { id: 'typescript', label: 'TypeScript', aliases: ['typescript', 'ts'], command: 'node', args: ['--experimental-strip-types', '--no-warnings'], extension: '.ts' },
  { id: 'python', label: 'Python', aliases: ['python', 'py', 'python3'], command: 'python3', windowsCommand: 'python', extension: '.py' },
  { id: 'bash', label: 'Bash', aliases: ['bash', 'sh', 'shell'], command: 'bash', extension: '.sh' },
  { id: 'zsh', label: 'Zsh', aliases: ['zsh'], command: 'zsh', extension: '.zsh' },
  { id: 'powershell', label: 'PowerShell', aliases: ['powershell', 'ps1', 'pwsh'], command: 'pwsh', windowsCommand: 'powershell', args: ['-NoProfile', '-File'], extension: '.ps1' },
  { id: 'ruby', label: 'Ruby', aliases: ['ruby', 'rb'], command: 'ruby', extension: '.rb' },
  { id: 'php', label: 'PHP', aliases: ['php'], command: 'php', extension: '.php' },
  { id: 'perl', label: 'Perl', aliases: ['perl', 'pl'], command: 'perl', extension: '.pl' },
  { id: 'lua', label: 'Lua', aliases: ['lua'], command: 'lua', extension: '.lua' },
  { id: 'r', label: 'R', aliases: ['r'], command: 'Rscript', extension: '.R' },
  { id: 'go', label: 'Go', aliases: ['go', 'golang'], command: 'go', args: ['run'], extension: '.go' },
];

/** Finds the language a fence name stands for, ignoring case. */
export function languageFor(name: string): Language | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return LANGUAGES.find((l) => l.aliases.includes(key)) ?? null;
}

export interface CommandSpec {
  command: string;
  args: string[];
}

/** Splits on spaces; double quotes keep a path with spaces together. */
export function splitCommand(text: string): string[] {
  const parts: string[] = [];
  for (const m of text.matchAll(/"([^"]*)"|(\S+)/g)) parts.push(m[1] ?? m[2]);
  return parts;
}

/**
 * The program and arguments to run `file`. A user override replaces the
 * program only; it may carry its own flags ("python3 -u"), split on spaces.
 */
export function buildCommand(lang: Language, file: string, platform: string, override?: string): CommandSpec {
  const custom = override?.trim();
  if (custom) {
    const [command, ...extra] = splitCommand(custom);
    return { command, args: [...extra, ...(lang.args ?? []), file] };
  }
  const command = platform === 'win32' && lang.windowsCommand ? lang.windowsCommand : lang.command;
  return { command, args: [...(lang.args ?? []), file] };
}

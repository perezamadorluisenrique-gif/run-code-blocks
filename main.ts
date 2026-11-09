import { FileSystemAdapter, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { App, Editor, MarkdownPostProcessorContext } from 'obsidian';
import { dirname, join } from 'path';

import { fenceAtLine, outputEdit } from './src/fences.ts';
import { LANGUAGES, languageFor } from './src/languages.ts';
import type { Language } from './src/languages.ts';
import { combined, statusLine, succeeded } from './src/output.ts';
import { startRun } from './src/runner.ts';
import type { Run } from './src/runner.ts';

interface RunCodeBlocksSettings {
  /** The user has read the warning once. */
  acknowledged: boolean;
  timeoutSec: number;
  maxChars: number;
  workingDirectory: 'vault' | 'note';
  /** Program overrides keyed by language id, e.g. python: "python3 -u". */
  commands: Record<string, string>;
}

const DEFAULT_SETTINGS: RunCodeBlocksSettings = {
  acknowledged: false,
  timeoutSec: 30,
  maxChars: 20000,
  workingDirectory: 'vault',
  commands: {},
};

/** One-time warning: code blocks run with the user's own permissions. */
class ConsentModal extends Modal {
  constructor(app: App, private readonly onChoice: (ok: boolean) => void) {
    super(app);
  }

  private chosen = false;

  onOpen(): void {
    this.titleEl.setText('Run code from your notes?');
    this.contentEl.createEl('p', {
      text: 'Code runs on this computer with your own permissions, exactly as if you had typed it in a terminal. It can read, change or delete files and use the network. Only run code you wrote or trust, including code in notes you got from others.',
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText('I understand, run it')
          .setCta()
          .onClick(() => {
            this.chosen = true;
            this.onChoice(true);
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.chosen) this.onChoice(false);
  }
}

export default class RunCodeBlocksPlugin extends Plugin {
  settings: RunCodeBlocksSettings = { ...DEFAULT_SETTINGS };
  private readonly runs = new Set<Run>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new RunCodeBlocksSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((el, ctx) => this.decorate(el, ctx));

    this.addCommand({
      id: 'run-block-insert-output',
      name: 'Run code block at cursor and insert its output',
      icon: 'play',
      editorCheckCallback: (checking, editor, view) => {
        const found = this.blockAtCursor(editor);
        if (!found) return false;
        if (!checking) void this.runIntoNote(editor, view instanceof MarkdownView ? view.file?.path : undefined, found.lang, found.code, found.line);
        return true;
      },
    });

    this.addCommand({
      id: 'stop-running-code',
      name: 'Stop all running code',
      icon: 'square',
      checkCallback: (checking) => {
        if (this.runs.size === 0) return false;
        if (!checking) this.stopAll();
        return true;
      },
    });
  }

  onunload() {
    this.stopAll();
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<RunCodeBlocksSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, commands: { ...(saved?.commands ?? {}) } };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private stopAll() {
    for (const run of this.runs) run.stop();
  }

  private blockAtCursor(editor: Editor): { lang: Language; code: string; line: number } | null {
    const fence = fenceAtLine(editor.getValue(), editor.getCursor().line);
    const lang = fence ? languageFor(fence.lang) : null;
    if (!fence || !lang) return null;
    return { lang, code: fence.code, line: fence.startLine };
  }

  private async confirmed(): Promise<boolean> {
    if (this.settings.acknowledged) return true;
    const ok = await new Promise<boolean>((resolve) => new ConsentModal(this.app, resolve).open());
    if (ok) {
      this.settings.acknowledged = true;
      await this.saveSettings();
    }
    return ok;
  }

  private workingDir(sourcePath?: string): string | undefined {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return undefined;
    const base = adapter.getBasePath();
    if (this.settings.workingDirectory === 'note' && sourcePath) return join(base, dirname(sourcePath));
    return base;
  }

  private start(lang: Language, code: string, sourcePath: string | undefined, onData?: (chunk: string) => void): Run {
    const run = startRun({
      lang,
      code,
      cwd: this.workingDir(sourcePath),
      override: this.settings.commands[lang.id],
      timeoutSec: this.settings.timeoutSec,
      maxChars: this.settings.maxChars,
      onData,
    });
    this.runs.add(run);
    void run.done.then(() => this.runs.delete(run));
    return run;
  }

  /** Editing view: run the block under the cursor, write ```output below it. */
  private async runIntoNote(editor: Editor, sourcePath: string | undefined, lang: Language, code: string, line: number) {
    if (!(await this.confirmed())) return;
    const notice = new Notice(`Running ${lang.label}…`, 0);
    const result = await this.start(lang, code, sourcePath).done;
    notice.hide();
    const text = combined(result, this.settings.maxChars);
    // Re-find the block: the note may have changed while the code ran.
    const fence = fenceAtLine(editor.getValue(), line);
    if (!fence || fence.code !== code) {
      new Notice('The code block changed while it ran, so the output was not inserted.');
      return;
    }
    const edit = outputEdit(editor.getValue(), fence, text || statusLine(result));
    const end = { line: edit.fromLine, ch: editor.getLine(edit.fromLine).length };
    editor.transaction({
      changes: [edit.atEnd ? { from: end, to: end, text: edit.insert } : { from: { line: edit.fromLine, ch: 0 }, to: { line: edit.toLine, ch: 0 }, text: edit.insert }],
    });
    new Notice(statusLine(result));
  }

  /** Reading view: a Run button on each runnable block, output underneath. */
  private decorate(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    for (const pre of Array.from(el.querySelectorAll('pre'))) {
      const code = pre.querySelector('code');
      if (!code) continue;
      const name = Array.from(code.classList).find((c) => c.startsWith('language-'))?.slice('language-'.length);
      const lang = name ? languageFor(name) : null;
      if (!lang) continue;

      const bar = createDiv({ cls: 'rcb-bar' });
      pre.insertAdjacentElement('afterend', bar);
      const button = bar.createEl('button', { text: 'Run', cls: 'rcb-run', attr: { 'aria-label': `Run this ${lang.label} code` } });
      const status = bar.createSpan({ cls: 'rcb-status' });
      const out = bar.createEl('pre', { cls: 'rcb-output' });
      out.hide();

      let current: Run | null = null;
      button.addEventListener('click', () => {
        if (current) {
          current.stop();
          return;
        }
        void (async () => {
          if (!(await this.confirmed())) return;
          out.empty();
          out.hide();
          button.setText('Stop');
          button.setAttribute('aria-label', `Stop this ${lang.label} code`);
          status.setText('Running…');
          let shown = 0;
          let hidden = 0;
          current = this.start(lang, code.textContent ?? '', ctx.sourcePath, (chunk) => {
            if (shown >= this.settings.maxChars) {
              hidden += chunk.length;
              return;
            }
            const part = chunk.slice(0, Math.max(0, this.settings.maxChars - shown));
            hidden += chunk.length - part.length;
            shown += part.length;
            out.appendText(part);
            out.show();
          });
          const result = await current.done;
          current = null;
          button.setText('Run');
          button.setAttribute('aria-label', `Run this ${lang.label} code`);
          if (hidden > 0) out.appendText(`\n… ${hidden} more characters not shown`);
          status.setText(statusLine(result));
          status.toggleClass('rcb-failed', !succeeded(result));
        })();
      });
    }
  }
}

class RunCodeBlocksSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RunCodeBlocksPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName('Time limit')
      .setDesc('Seconds before a run is stopped. Zero means no limit.')
      .addText((t) =>
        t.setValue(String(s.timeoutSec)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) return;
          s.timeoutSec = n;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Output limit')
      .setDesc('Most characters kept from each of the output and the errors.')
      .addText((t) =>
        t.setValue(String(s.maxChars)).onChange(async (v) => {
          const n = Math.floor(Number(v));
          if (!Number.isFinite(n) || n < 100) return;
          s.maxChars = n;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Run in')
      .setDesc('The folder the program starts in.')
      .addDropdown((d) =>
        d
          .addOption('vault', 'Vault root')
          .addOption('note', "The note's folder")
          .setValue(s.workingDirectory)
          .onChange(async (v) => {
            s.workingDirectory = v === 'note' ? 'note' : 'vault';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('Programs').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Leave blank to use the default. Fill in a full path or extra flags, such as /usr/local/bin/python3 -u.',
    });
    for (const lang of LANGUAGES) {
      new Setting(containerEl)
        .setName(lang.label)
        .setDesc(`Fences: ${lang.aliases.join(', ')}. Default: ${lang.command}`)
        .addText((t) =>
          t
            .setPlaceholder(lang.command)
            .setValue(s.commands[lang.id] ?? '')
            .onChange(async (v) => {
              if (v.trim()) s.commands[lang.id] = v.trim();
              else delete s.commands[lang.id];
              await this.plugin.saveSettings();
            }),
        );
    }
  }
}

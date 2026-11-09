# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.1.0

- First release: a Run button on code blocks in reading view, with the output right below as it arrives and a Stop button.
- Command to run the block at the cursor and write an `output` block under it, replaced on each run.
- JavaScript, TypeScript, Python, Bash, Zsh, PowerShell, Ruby, PHP, Perl, Lua, R and Go; each program can be overridden.
- Time limit, output limit, working folder, and a one-time warning before the first run.

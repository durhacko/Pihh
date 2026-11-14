# Readiness: Arnav (`reverez`)

Checked Sat 14 Nov 2026, 19:55 GMT, by Arnav's orchestrator agent (Claude Code).

| Check | Result |
|---|---|
| `gh auth status` | Logged in as `reverez`, on Windows (Git Bash) and inside WSL |
| Laptop | Windows 11 with WSL Ubuntu 24.04; the clone lives in WSL |
| Node / npm | WSL: Node v24.21.0, npm 11.19.0. Windows: Node v24.14.0, npm 11.9.0 |
| Clone and checks | `npm ci` and `bash scripts/check.sh` pass in WSL on the scaffold branch (PR #38, before merge). **Run npm inside WSL**: it does not work on the `\wsl.localhost` path from Windows |
| Issue claiming | Exercised (this issue, and #4, #12, #32, #37) |
| PR workflow | Exercised as author (PRs #10, #11, #30, #31, #33, #39) and as reviewer (#38). **Not yet exercised: a teammate merging one of Arnav's PRs.** This PR is that test |
| TypeScript / Three.js experience | Not recorded: Arnav to fill in |
| Awake overnight | Not recorded: Arnav to fill in |

Git on a worktree under `\wsl.localhost` from Git Bash fails with "dubious ownership"; use git inside WSL for worktrees.

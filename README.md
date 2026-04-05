# repoctl

Multi-repo dev environment orchestrator. One command creates isolated environments with their own git worktrees, port assignments, `.env` files, and SQLite DB copies — across all your repos simultaneously.

Built for projects where **the unit of "an environment" is not one repo, but a named group of repos that form one application**.

---

## The Problem

If your full-stack app lives in multiple git repos (API, frontend, chat UI, etc.) and you want to work on two features in parallel, every tool stops helping you at the repo boundary. Git worktrees are per-repo. Port conflicts are manual. `.env` files need editing. DB state bleeds across sessions.

`repoctl` solves all of that in one command.

---

## Install

```bash
npm install -g repoctl
```

Or run directly with `npx`:

```bash
npx repoctl init
```

---

## Quick Start

**1. Create a config file** (interactive):

```bash
cd /path/to/your/project-folder   # the folder containing all your repos
repoctl init
```

This creates `.repoctl.yaml`. See [`.repoctl.example.yaml`](./.repoctl.example.yaml) for a fully annotated example.

**2. Create an isolated environment:**

```bash
repoctl env create feature-auth
```

This creates:
- A git worktree in each repo at `<repo>/.repoctl-worktrees/feature-auth`
- A new branch `repoctl/feature-auth/<service>` in each repo
- Per-env `.env` files with correct port assignments
- A copy of your SQLite DB (`dev.sqlite` → `dev-feature-auth.sqlite`)

**3. Start services:**

```bash
repoctl env start feature-auth
```

Each service starts in its own worktree directory with the correct `PORT` and cross-service URLs set.

**4. See what's running:**

```bash
repoctl env list
repoctl env status feature-auth
```

**5. Destroy when done:**

```bash
repoctl env destroy feature-auth
```

---

## Commands

### Environment management

```bash
repoctl env create <name>           # create isolated environment
  --branch <branch>                  # checkout existing branch in all repos
  --no-db                            # skip DB copy
  --seed                             # run seed command after DB copy

repoctl env bind <name>            # bind to feature-env for AI agents
repoctl env active                  # show currently bound env
repoctl env unbind                  # clear binding
repoctl env info <name>             # detailed env info

repoctl env start <name>            # start all services
  --service <name>                   # start one service only

repoctl env stop <name>             # stop all services
repoctl env restart <name>          # stop then start

repoctl env status <name>           # detailed per-service status
repoctl env list                    # all environments, ports, running status

repoctl env destroy <name>          # remove worktrees + DB + manifest
  --keep-db                          # preserve the DB copy
  -y, --yes                          # skip confirmation
```

### Known-good combos (the differentiator)

Record the exact commit SHAs across all repos when everything is working. Restore them later.

```bash
repoctl lock record <combo-name> <env-name>   # save current SHAs
  --tested                                     # mark as verified
  -n, --notes "description"                    # add notes

repoctl lock list                              # show all saved combos
repoctl lock restore <combo-name> <env-name>  # checkout all repos to saved SHAs
repoctl lock delete <combo-name>              # remove a combo
```

### Other

```bash
repoctl init                        # interactive config setup
repoctl validate                    # check config and repo paths
repoctl open <name>                 # print worktree paths (use with $EDITOR)
  --service <name>                   # print one service's path
```

---

## Config: `.repoctl.yaml`

```yaml
name: my-project
description: Full-stack app

port_strategy:
  base: 3000
  stride: 100           # env 0 gets 3000-3099, env 1 gets 3100-3199, etc.

services:
  - name: api
    repo: backend/my-api
    port_offset: 0
    start: npm run start:dev
    env_file: .env
    pre_run: npm install      # run before starting (default: "npm install" if true)

  - name: app
    repo: frontend/my-app
    port_offset: 1
    start: npm run dev
    pre_run:                 # true = npm install, false = skip, "always" = rerun each time
      - npm install
      - npm run build

port_rewrites:
  - service: app
    env_var: NEXT_PUBLIC_API_URL
    template: "http://localhost:{api.port}"

database:
  type: sqlite
  service: api
  env_var: DATABASE_FILE
  base_file: dev.sqlite
  seed_command: npm run seed

worktree_copy:
  - .env
  - .env.local
```

See `.repoctl.example.yaml` for full annotations.

---

## Pre-run scripts

Worktrees are fresh checkouts — they need `npm install` before services can start. Configure `pre_run` to automatically run setup commands:

```yaml
services:
  - name: app
    repo: frontend/my-app
    start: npm run dev
    pre_run: npm install    # runs once, then skips (marker file created)
```

**Values:**

| Value | Behavior |
|-------|----------|
| `true` | Run `npm install` |
| `false` | Skip pre-run entirely |
| `"always"` | Run every time (no marker file) |
| `string` | Run that command |
| `array` | Run all commands in sequence |

**How it works:**

1. On `repoctl env start`, checks for `.repoctl-pre-run-done` marker file
2. If marker exists (and not `"always"`), skips pre-run
3. Runs commands with streaming output
4. On success, writes marker file with timestamp
5. Then starts the service

**Force re-run:**

```bash
repoctl env start my-env --force   # re-run pre_run even if done
```

---

## How port assignment works

```
port = base + (env_index * stride) + service_offset
```

Example with `base: 3000, stride: 100`:

| Environment | api  | app  | chat |
|-------------|------|------|------|
| (index 0)   | 3000 | 3001 | 3002 |
| feature-auth (index 1) | 3100 | 3101 | 3102 |
| v3-dates (index 2)    | 3200 | 3201 | 3202 |

Indexes are assigned sequentially and never reused. Gaps are fine.

---

## State storage

All state lives in `.repoctl/` at the project root:

```
.repoctl/
  envs/
    feature-auth.yaml    # env manifest with ports, SHAs, worktree paths
  pids/
    feature-auth-api.pid # PID of the running service
  known-good.yaml        # recorded known-good SHA combos
  active.yaml            # currently bound feature-env (for AI agents)
```

Add `.repoctl/` to your project root's `.gitignore`.

---

## Using with AI coding agents

`repoctl` is AI-tool-agnostic. Create an environment, then point any agent at the worktree:

```bash
# Create env
repoctl env create feature-auth

# Get the api worktree path
repoctl open feature-auth --service api
# → /path/to/project/backend/my-api/.repoctl-worktrees/feature-auth

# Open Claude Code, Cursor, or any tool in that directory
claude /path/to/project/backend/my-api/.repoctl-worktrees/feature-auth
```

The AI agent works in an isolated copy. Your main checkout is untouched.

### Feature-env binding (soft bounding)

For AI agents that support it, bind an environment to enable "soft bounding" — telling the agent which repos belong to which feature:

```bash
# Bind to a feature-env
repoctl env bind feature-auth

# See what's bound
repoctl env active

# Clear binding when done
repoctl env unbind
```

This writes `.repoctl/active.yaml` with:
- Environment name
- Timestamp
- All bound worktree paths

AI agents can read this file on startup to understand their context.

### Symlink wrapper

Creating an environment also creates a unified view at `.repoctl-worktrees/<name>/`:

```
.repoctl-worktrees/feature-auth/
  ├── my-api  → /path/to/project/backend/my-api/.repoctl-worktrees/feature-auth
  ├── my-app  → /path/to/project/frontend/my-app/.repoctl-worktrees/feature-auth
  └── my-chat → /path/to/project/chat/my-chat/.repoctl-worktrees/feature-auth
```

This gives you a single directory to view all feature-repos. It's optional — the binding system works without it.

---

## Requirements

- Node.js 18+
- Git 2.5+ (for `git worktree` support)
- macOS or Linux (`lsof` required for port conflict detection)

---

## License

MIT

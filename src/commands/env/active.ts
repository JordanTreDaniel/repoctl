// ✦ active.ts — read/show the currently bound feature-env

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadConfig, getStateDir } from '../../core/config.js';

export interface ActiveOptions {
  configPath?: string;
  json?: boolean;
}

// WHAT: shows the currently bound feature-env from .repoctl/active.yaml
// WHY:  lets agents discover which env they're bound to on startup
// EDGE: returns exit code 1 if no active env is set
export function showActive(opts: ActiveOptions): void {
  const { rootDir } = loadConfig(opts.configPath);
  const activePath = path.join(getStateDir(rootDir), 'active.yaml');

  if (!fs.existsSync(activePath)) {
    if (opts.json) {
      console.log(JSON.stringify({ bound: false }));
    } else {
      console.log(chalk.dim('  No active environment bound.'));
    }
    process.exit(1);
  }

  const active = yaml.load(fs.readFileSync(activePath, 'utf8')) as {
    env_name: string;
    bound_at: string;
    worktrees: Record<string, string>;
  };

  if (opts.json) {
    console.log(JSON.stringify({ bound: true, ...active }, null, 2));
  } else {
    console.log(chalk.bold(`\n  Active environment: ${chalk.cyan(active.env_name)}\n`));
    console.log(chalk.dim(`  bound_at: ${active.bound_at}`));
    console.log(chalk.dim('  worktrees:'));
    for (const [svcName, wtPath] of Object.entries(active.worktrees)) {
      console.log(chalk.dim(`    ${svcName} → ${wtPath}`));
    }
    console.log();
  }
}

// WHAT: unbinds the current shell by removing .repoctl/active.yaml
// WHY:  cleans up binding when done with a feature
// EDGE: silent no-op if no active env is set
export function clearActive(opts: ActiveOptions): void {
  const { rootDir } = loadConfig(opts.configPath);
  const activePath = path.join(getStateDir(rootDir), 'active.yaml');

  if (fs.existsSync(activePath)) {
    fs.unlinkSync(activePath);
    console.log(chalk.green('\n  ✓ Cleared active environment.\n'));
  } else {
    console.log(chalk.dim('\n  No active environment to clear.\n'));
  }
}

// ✦ END active.ts

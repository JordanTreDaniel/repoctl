// ✦ bind.ts — implements 'repoctl env bind <name>'

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadConfig, getStateDir, ensureStateDir } from '../../core/config.js';
import { readManifest } from '../../core/manifest.js';
import { getWrapperPath, readWrapper } from '../../core/worktrees.js';

export interface BindOptions {
  configPath?: string;
}

// WHAT: binds the current shell to a feature-env, writing .repoctl/active.yaml
// WHY:  enables soft bounding - tells agents which worktrees belong to which feature
// EDGE: overwrites any existing active.yaml; validates env exists first
export function bindEnv(envName: string, opts: BindOptions): void {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    console.error(chalk.gray(`  Run 'repoctl env list' to see available environments.`));
    process.exit(1);
  }

  const wrapperPath = getWrapperPath(rootDir, envName);
  const boundWorktrees = readWrapper(rootDir, envName);

  const activeConfig = {
    env_name: envName,
    bound_at: new Date().toISOString(),
    worktrees: boundWorktrees,
    manifest: {
      created: manifest.created,
      env_index: manifest.env_index,
      services: manifest.services,
      db_file: manifest.db_file,
    },
  };

  ensureStateDir(rootDir);
  const activePath = path.join(getStateDir(rootDir), 'active.yaml');
  fs.writeFileSync(activePath, yaml.dump(activeConfig), 'utf8');

  console.log(chalk.green(`\n  ✓ Bound to environment: ${chalk.cyan(envName)}\n`));
  console.log(chalk.dim('  Worktrees:'));
  for (const [svcName, wtPath] of Object.entries(boundWorktrees)) {
    console.log(chalk.dim(`    ${svcName} → ${wtPath}`));
  }
  console.log();
  console.log(chalk.dim(`  Active config written to: ${chalk.white(path.relative(rootDir, activePath))}`));
  console.log();
}

// ✦ END bind.ts

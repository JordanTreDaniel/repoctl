// ✦ info.ts — implements 'repoctl env info <name>'

import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { readManifest } from '../../core/manifest.js';
import { getWrapperPath, readWrapper } from '../../core/worktrees.js';

export interface InfoOptions {
  configPath?: string;
}

// WHAT: shows detailed info about a feature-env, including bound worktrees
// WHY:  gives visibility into what's in an env without having to start it
// EDGE: shows both manifest data and wrapper symlink data
export function infoEnv(envName: string, opts: InfoOptions): void {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    console.error(chalk.gray(`  Run 'repoctl env list' to see available environments.`));
    process.exit(1);
  }

  const wrapperPath = getWrapperPath(rootDir, envName);
  const boundWorktrees = readWrapper(rootDir, envName);

  console.log(chalk.bold(`\n  Environment: ${chalk.cyan(envName)}\n`));

  console.log(chalk.dim('  General:'));
  console.log(chalk.dim(`    created:     ${manifest.created}`));
  console.log(chalk.dim(`    env_index:   ${manifest.env_index}`));
  if (manifest.db_file) {
    console.log(chalk.dim(`    db_file:     ${manifest.db_file}`));
  }
  console.log();

  console.log(chalk.dim('  Worktrees:'));
  for (const [svcName, svc] of Object.entries(manifest.services)) {
    const boundPath = boundWorktrees[svcName] ?? svc.worktree_path;
    console.log(chalk.dim(`    ${svcName.padEnd(12)}`));
    console.log(chalk.dim(`      path:    ${boundPath}`));
    console.log(chalk.dim(`      branch:  ${svc.branch}`));
    console.log(chalk.dim(`      sha:     ${svc.sha.slice(0, 7)}`));
    console.log(chalk.dim(`      port:    ${svc.port}`));
    if (svc.pid) {
      console.log(chalk.dim(`      pid:     ${svc.pid}`));
    }
  }
  console.log();

  console.log(chalk.dim(`  Wrapper:   ${wrapperPath}`));
  console.log(chalk.dim(`  Symlinks:  ${Object.keys(boundWorktrees).length} bound`));
  console.log();
}

// ✦ END info.ts

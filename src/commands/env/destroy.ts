// ✦ destroy.ts — implements 'repoctl env destroy <name>'

import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { readManifest, deleteManifest, deletePid } from '../../core/manifest.js';
import { removeWorktreesForEnv } from '../../core/worktrees.js';
import { deleteDatabase } from '../../core/database.js';

export interface DestroyOptions {
  keepDb?: boolean;
  yes?: boolean;
  configPath?: string;
}

// WHAT: destroys an environment by removing worktrees, DB copy, .env overrides, and manifest
// WHY:  environments accumulate disk space; destroy is the clean way to remove one
// EDGE: uncommitted changes in worktrees are lost — the --yes flag bypasses the confirmation prompt
export async function destroyEnv(envName: string, opts: DestroyOptions): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  if (!opts.yes) {
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message: `Destroy environment '${envName}'? Uncommitted worktree changes will be lost.`,
      default: false,
    });
    if (!confirmed) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  console.log(chalk.bold(`\n  Destroying environment: ${chalk.cyan(envName)}\n`));

  // Remove worktrees
  console.log(chalk.dim('  Removing git worktrees...'));
  removeWorktreesForEnv(rootDir, config, envName);
  console.log(chalk.dim('    ✓ worktrees removed'));

  // Remove database
  if (config.database && !opts.keepDb) {
    console.log(chalk.dim('  Removing database copy...'));
    deleteDatabase({ rootDir, config, envName });
    console.log(chalk.dim(`    ✓ ${manifest.db_file ?? 'db file'} deleted`));
  } else if (opts.keepDb) {
    console.log(chalk.dim(`  Keeping database: ${manifest.db_file}`));
  }

  // Remove PID files
  for (const svcName of Object.keys(manifest.services)) {
    deletePid(rootDir, envName, svcName);
  }

  // Remove manifest
  deleteManifest(rootDir, envName);

  console.log(chalk.green(`\n  ✓ Environment '${envName}' destroyed.\n`));
}

// ✦ END destroy.ts

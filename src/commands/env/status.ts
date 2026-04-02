// ✦ status.ts — implements 'repoctl env status <name>'

import fs from 'fs';
import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { readManifest, readPid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';

export interface StatusOptions {
  configPath?: string;
}

// WHAT: prints detailed status for a single environment including per-service info
// WHY:  list shows a summary; status shows full detail for debugging a specific env
// EDGE: worktree_exists check uses filesystem — a deleted worktree shows as missing even if manifest exists
export async function statusEnv(envName: string, opts: StatusOptions): Promise<void> {
  const { rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  Environment: ${chalk.cyan(manifest.name)}`));
  console.log(chalk.dim(`  Created:     ${new Date(manifest.created).toLocaleString()}`));
  console.log(chalk.dim(`  Env index:   ${manifest.env_index}`));
  if (manifest.db_file) {
    console.log(chalk.dim(`  Database:    ${manifest.db_file}`));
  }

  console.log(chalk.bold('\n  Services:\n'));

  for (const [svcName, svc] of Object.entries(manifest.services)) {
    const running = isPortInUse(svc.port);
    const pid = readPid(rootDir, envName, svcName);
    const wtExists = fs.existsSync(svc.worktree_path);

    const status = running ? chalk.green('● running') : chalk.dim('○ stopped');
    console.log(`    ${chalk.bold(svcName.padEnd(14))} ${status}`);
    console.log(chalk.dim(`      port:    ${svc.port}`));
    console.log(chalk.dim(`      branch:  ${svc.branch}`));
    console.log(chalk.dim(`      sha:     ${svc.sha.slice(0, 8)}`));
    console.log(chalk.dim(`      path:    ${svc.worktree_path}`));
    console.log(chalk.dim(`      exists:  ${wtExists ? chalk.green('yes') : chalk.red('no (worktree missing)')}`));
    if (pid != null) console.log(chalk.dim(`      pid:     ${pid}`));
    console.log();
  }
}

// ✦ END status.ts

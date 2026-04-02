// ✦ create.ts — implements 'repoctl env create <name>'

import chalk from 'chalk';
import { loadConfig, ensureStateDir } from '../../core/config.js';
import { envExists, writeManifest } from '../../core/manifest.js';
import { nextEnvIndex, computePortMap, checkPortConflicts } from '../../core/ports.js';
import { addWorktreesForEnv } from '../../core/worktrees.js';
import { setupAllEnvFiles } from '../../core/env-files.js';
import { copyDatabase, seedDatabase } from '../../core/database.js';
import type { EnvManifest } from '../../core/types.js';

export interface CreateOptions {
  branch?: string;
  noDb?: boolean;
  seed?: boolean;
  configPath?: string;
}

// WHAT: creates an isolated dev environment with its own worktrees, ports, .env files, and DB copy
// WHY:  the core env create command — orchestrates all sub-steps in the right order
// EDGE: if any step fails mid-way, the env manifest is not written; user should run destroy to clean up partial state
export async function createEnv(envName: string, opts: CreateOptions): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  ensureStateDir(rootDir);

  if (envExists(rootDir, envName)) {
    console.error(chalk.red(`✗ Environment '${envName}' already exists.`));
    console.error(chalk.gray(`  Run 'repoctl env destroy ${envName}' first to recreate it.`));
    process.exit(1);
  }

  const envIndex = nextEnvIndex(rootDir);
  const portMap = computePortMap(config, envIndex);

  console.log(chalk.bold(`\n  Creating environment: ${chalk.cyan(envName)}\n`));

  // Port conflict check
  const conflicts = checkPortConflicts(portMap);
  if (conflicts.length > 0) {
    console.error(chalk.red('✗ Port conflicts detected:'));
    conflicts.forEach((c) => console.error(chalk.red(`  • ${c}`)));
    process.exit(1);
  }

  // Print port assignments
  console.log(chalk.dim('  Port assignments:'));
  for (const [svc, port] of Object.entries(portMap)) {
    console.log(chalk.dim(`    ${svc.padEnd(12)} → ${port}`));
  }
  console.log();

  // Create worktrees
  console.log(chalk.dim('  Creating git worktrees...'));
  const worktreeResults = addWorktreesForEnv(rootDir, config, envName, opts.branch);
  const worktreePaths: Record<string, string> = {};
  const serviceManifests: EnvManifest['services'] = {};

  for (const [svcName, result] of Object.entries(worktreeResults)) {
    worktreePaths[svcName] = result.worktreePath;
    serviceManifests[svcName] = {
      port: portMap[svcName],
      worktree_path: result.worktreePath,
      branch: result.branch,
      sha: result.sha,
    };
    console.log(chalk.dim(`    ✓ ${svcName} → ${result.branch}`));
  }

  // Copy database
  let dbFilename: string | undefined;
  if (config.database && !opts.noDb) {
    console.log(chalk.dim('\n  Copying database...'));
    dbFilename = copyDatabase({ rootDir, config, envName });
    console.log(chalk.dim(`    ✓ ${config.database.base_file} → ${dbFilename}`));

    if (opts.seed && config.database.seed_command) {
      console.log(chalk.dim('\n  Seeding database...'));
      seedDatabase({ rootDir, config, worktreePaths });
      console.log(chalk.dim('    ✓ seed complete'));
    }
  }

  // Set up .env files
  console.log(chalk.dim('\n  Writing .env files...'));
  setupAllEnvFiles({
    rootDir,
    config,
    envName,
    portMap,
    worktreePaths,
    dbFileName: dbFilename,
  });
  for (const svc of config.services) {
    console.log(chalk.dim(`    ✓ ${svc.name}/${svc.env_file ?? '.env'}`));
  }

  // Write manifest
  const manifest: EnvManifest = {
    name: envName,
    created: new Date().toISOString(),
    env_index: envIndex,
    services: serviceManifests,
    db_file: dbFilename,
  };
  writeManifest(rootDir, manifest);

  console.log(chalk.green(`\n  ✓ Environment '${envName}' created.\n`));
  console.log(chalk.dim(`  Start it with: ${chalk.white(`repoctl env start ${envName}`)}`));
  console.log();
}

// ✦ END create.ts

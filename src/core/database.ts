// ✦ database.ts — SQLite database isolation for repoctl environments

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { RepoctlConfig } from './types.js';

// WHAT: builds the DB filename for an environment
// WHY:  each env gets a uniquely named DB file so they never share state
// EDGE: the env name is embedded in the filename; names with slashes would break paths
export function envDbFilename(baseFile: string, envName: string): string {
  const ext = path.extname(baseFile);
  const base = path.basename(baseFile, ext);
  const safeName = envName.replace(/\//g, '-');
  return `${base}-${safeName}${ext}`;
}

// WHAT: copies the base SQLite file to a new env-specific filename
// WHY:  two envs sharing one DB file means mutations in one corrupt the other's state
// EDGE: if the base file doesn't exist, an empty file is created (fresh DB, will need seeding)
export function copyDatabase(opts: {
  rootDir: string;
  config: RepoctlConfig;
  envName: string;
}): string {
  const { rootDir, config, envName } = opts;
  if (!config.database) throw new Error('No database config defined');

  const dbSvc = config.services.find((s) => s.name === config.database!.service);
  if (!dbSvc) throw new Error(`DB service '${config.database.service}' not found`);

  const dbDir = path.join(rootDir, dbSvc.repo);
  const srcFile = path.join(dbDir, config.database.base_file);
  const dstFilename = envDbFilename(config.database.base_file, envName);
  const dstFile = path.join(dbDir, dstFilename);

  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, dstFile);
  } else {
    // create empty file — seed_command will initialize it
    fs.writeFileSync(dstFile, '');
  }

  return dstFilename;
}

// WHAT: deletes the env-specific DB file
// WHY:  env destroy should clean up all env-specific state, including the DB copy
// EDGE: silent no-op if the file doesn't exist (partial create or already deleted)
export function deleteDatabase(opts: {
  rootDir: string;
  config: RepoctlConfig;
  envName: string;
}): void {
  const { rootDir, config, envName } = opts;
  if (!config.database) return;

  const dbSvc = config.services.find((s) => s.name === config.database!.service);
  if (!dbSvc) return;

  const dbDir = path.join(rootDir, dbSvc.repo);
  const dstFilename = envDbFilename(config.database.base_file, envName);
  const dstFile = path.join(dbDir, dstFilename);

  if (fs.existsSync(dstFile)) fs.unlinkSync(dstFile);
}

// WHAT: runs the seed command for an environment's DB service
// WHY:  a fresh (or empty) DB needs initialization data before the app can run
// EDGE: the seed command runs inside the worktree directory for the DB service
export function seedDatabase(opts: {
  rootDir: string;
  config: RepoctlConfig;
  worktreePaths: Record<string, string>;
}): void {
  const { config, worktreePaths } = opts;
  if (!config.database?.seed_command) return;

  const dbSvc = config.database.service;
  const wtPath = worktreePaths[dbSvc];
  if (!wtPath) throw new Error(`Worktree path not found for DB service '${dbSvc}'`);

  execSync(config.database.seed_command, { cwd: wtPath, stdio: 'inherit' });
}

// ✦ END database.ts

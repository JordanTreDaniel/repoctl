// ✦ config.ts — loads and validates .repoctl.yaml from the project root

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { RepoctlConfig } from './types.js';

const K_CONFIG_FILENAME = '.repoctl.yaml';

// WHAT: walks up from cwd to find the nearest .repoctl.yaml
// WHY:  lets repoctl be invoked from anywhere inside the project tree
// EDGE: returns null if not found — callers must handle missing config
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, K_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// WHAT: loads and parses .repoctl.yaml, returning a validated config object
// WHY:  centralizes config loading so all commands get the same parsed shape
// EDGE: throws with a human-readable message on missing file or invalid YAML
export function loadConfig(configPath?: string): { config: RepoctlConfig; rootDir: string } {
  const resolved = configPath ?? findConfigFile();
  if (!resolved) {
    throw new Error(
      `No ${K_CONFIG_FILENAME} found. Run 'repoctl init' to create one, or cd to your project root.`
    );
  }
  const rootDir = path.dirname(resolved);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = yaml.load(raw) as RepoctlConfig;
  validateConfig(parsed, resolved);
  return { config: parsed, rootDir };
}

// WHAT: validates required fields and repo paths in the config
// WHY:  fail-fast with clear messages rather than cryptic errors later
// EDGE: does not check if branches exist — that's a worktree concern
function validateConfig(config: RepoctlConfig, filePath: string): void {
  const errors: string[] = [];
  const rootDir = path.dirname(filePath);

  if (!config.name) errors.push('Missing required field: name');
  if (config.env_offset == null) errors.push('Missing required field: env_offset');
  if (!config.services || config.services.length === 0) {
    errors.push('Must define at least one service');
  }

  for (const svc of config.services ?? []) {
    if (!svc.name) errors.push('A service is missing its name');
    if (!svc.repo) errors.push(`Service '${svc.name}' is missing its repo path`);
    if (svc.port == null) errors.push(`Service '${svc.name}' is missing port`);
    if (!svc.start) errors.push(`Service '${svc.name}' is missing start command`);

    const repoPath = path.join(rootDir, svc.repo);
    if (!fs.existsSync(repoPath)) {
      errors.push(`Service '${svc.name}': repo path does not exist: ${repoPath}`);
    }
  }

  if (config.database) {
    const db = config.database;
    if (!db.service) errors.push('database.service is required');
    if (!db.env_var) errors.push('database.env_var is required');
    if (!db.base_file) errors.push('database.base_file is required');
    const svcNames = (config.services ?? []).map((s) => s.name);
    if (db.service && !svcNames.includes(db.service)) {
      errors.push(`database.service '${db.service}' is not a defined service`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed in ${filePath}:\n  • ${errors.join('\n  • ')}`);
  }
}

// WHAT: returns the path to the .repoctl state directory inside the project root
// WHY:  centralizes state dir location so all commands use the same path
// EDGE: does not create the directory — callers must call ensureStateDir()
export function getStateDir(rootDir: string): string {
  return path.join(rootDir, '.repoctl');
}

// WHAT: creates the .repoctl state directory and subdirectories if they don't exist
// WHY:  new projects won't have this dir; commands need it before writing manifests
// EDGE: safe to call multiple times (uses recursive: true)
export function ensureStateDir(rootDir: string): string {
  const stateDir = getStateDir(rootDir);
  fs.mkdirSync(path.join(stateDir, 'envs'), { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'pids'), { recursive: true });
  return stateDir;
}

// ✦ END config.ts

// ✦ init.ts — implements 'repoctl init' — interactive .repoctl.yaml generator

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { RepoctlConfig, ServiceConfig } from '../core/types.js';

const K_CONFIG_FILENAME = '.repoctl.yaml';

const K_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.cache', 'coverage', '.repoctl', '.repoctl-worktrees',
]);

// WHAT: recursively finds all git repos under a base directory
// WHY:  init needs to discover all repos in a multi-repo project without manual input
// EDGE: skips common noise dirs (node_modules, dist, etc.) but won't parse .gitignore
function findGitRepos(baseDir: string, currentDir: string = baseDir, depth: number = 0): string[] {
  if (depth > 4) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (K_SKIP_DIRS.has(entry.name)) continue;

    const dirPath = path.join(currentDir, entry.name);
    const relPath = path.relative(baseDir, dirPath);

    if (fs.existsSync(path.join(dirPath, '.git'))) {
      results.push(relPath);
      // don't recurse inside a git repo
    } else {
      results.push(...findGitRepos(baseDir, dirPath, depth + 1));
    }
  }
  return results;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

// WHAT: extracts port from a script command string if present (--port, -p)
// WHY:  many dev scripts embed the port directly, e.g., "next dev --port 3001"
function extractPortFromScript(scriptValue: string): number | null {
  const portMatch = scriptValue.match(/(?:^|\s)--port[=\s]+(\d+)|(?:^|\s)-p[=\s]+(\d+)/);
  if (portMatch) {
    return parseInt(portMatch[1] || portMatch[2], 10);
  }
  return null;
}

// WHAT: scans package.json for start commands and port, preferring "dev" then "start"
// WHY:  reduces manual input — user just confirms the auto-detected command and port
function findStartCommandAndPort(repoDir: string): { start: string | null; port: number | null } {
  const pkgPath = path.join(repoDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return { start: null, port: null };

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { start: null, port: null };
  }

  const scripts = pkg.scripts;
  if (!scripts) return { start: null, port: null };

  // First, look for a script with "dev" in the key (case-insensitive)
  const devKeys = Object.keys(scripts).filter((k) => k.toLowerCase().includes('dev'));
  if (devKeys.length > 0) {
    const key = devKeys[0];
    const value = scripts[key];
    const port = extractPortFromScript(value);
    return { start: `npm run ${key}`, port };
  }

  // Otherwise, look for a script with "start" in the key
  const startKeys = Object.keys(scripts).filter((k) => k.toLowerCase().includes('start'));
  if (startKeys.length > 0) {
    const key = startKeys[0];
    const value = scripts[key];
    const port = extractPortFromScript(value);
    return { start: `npm run ${key}`, port };
  }

  return { start: null, port: null };
}

// WHAT: runs the interactive init wizard and writes .repoctl.yaml to the current directory
// WHY:  new projects need a guided setup — raw YAML editing is error-prone
// EDGE: if .repoctl.yaml already exists, prompts to overwrite rather than silently replacing it
export async function initProject(): Promise<void> {
  const { input, confirm, number, select, checkbox } = await import('@inquirer/prompts');
  const cwd = process.cwd();
  const configPath = path.join(cwd, K_CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    const overwrite = await confirm({
      message: `${K_CONFIG_FILENAME} already exists. Overwrite it?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  console.log(chalk.bold('\n  repoctl init\n'));
  console.log(chalk.dim('  This will create a .repoctl.yaml config file in the current directory.\n'));

  const detectedDirs = findGitRepos(cwd);

  const projectName = await input({
    message: 'Project name:',
    default: path.basename(cwd),
    validate: (v) => v.trim().length > 0 || 'Name is required',
  });

  const description = await input({ message: 'Description (optional):' });

  // Let the user select which repos to include via checkboxes
  let selectedRepos: string[];
  if (detectedDirs.length > 0) {
    selectedRepos = await checkbox({
      message: 'Select repos to include as services:',
      choices: detectedDirs.map((d) => ({ name: d, value: d, checked: true })),
      validate: (v) => v.length > 0 || 'Select at least one repo',
    });
  } else {
    console.log(chalk.yellow('  No git repos found. You can add service paths manually.\n'));
    const manualRepo = await input({
      message: 'Repo path (relative to project root):',
      validate: (v) => {
        if (!v.trim()) return 'Required';
        if (!fs.existsSync(path.join(cwd, v.trim()))) return `Path does not exist: ${v.trim()}`;
        return true;
      },
    });
    selectedRepos = [manualRepo];
  }

  console.log(chalk.dim('\n  Port configuration:'));
  console.log(chalk.dim('  Base ports: each service gets a base port (e.g., 3000, 3001, 3002)\n'));
  console.log(chalk.dim('  Worktree offset: each new environment adds this to all ports\n'));

  const envOffset = await number({
    message: '  Worktree port offset:',
    default: 10,
  });

  const services: ServiceConfig[] = [];

  for (let i = 0; i < selectedRepos.length; i++) {
    const repoPath = selectedRepos[i];
    const fullPath = path.join(cwd, repoPath);
    console.log(chalk.dim(`\n  Configure: ${chalk.white(repoPath)}`));

    const { start: detectedStart, port: detectedPort } = findStartCommandAndPort(fullPath);

    const name = await input({
      message: '    Service name:',
      default: path.basename(repoPath),
      validate: (v) => v.trim().length > 0 || 'Name is required',
    });

    const hasStart = await confirm({
      message: '    Does this service have a start command?',
      default: !!detectedStart,
    });

    let startCmd: string | null = null;
    if (hasStart) {
      startCmd = await input({
        message: '    Start command:',
        default: detectedStart ?? 'npm run dev',
        validate: (v) => v.trim().length > 0 || 'Start command is required',
      });
    }

    const port = await number({
      message: '    Base port:',
      default: detectedPort ?? (3000 + i),
    });

    const envFile = await input({ message: '    .env file name:', default: '.env' });

    services.push({
      name,
      repo: repoPath,
      port,
      start: startCmd,
      env_file: envFile,
    });
  }

  console.log();

  const hasDb = await confirm({
    message: 'Does this project use an SQLite database?',
    default: false,
  });

  let dbConfig = undefined;
  if (hasDb) {
    const dbService = await select({
      message: 'Which service owns the database?',
      choices: services.map((s) => ({ name: s.name, value: s.name })),
    });

    const dbEnvVar = await input({
      message: 'Env var that points to the DB file:',
      default: 'DATABASE_FILE',
    });

    const dbBaseFile = await input({
      message: 'Base DB filename (to copy for new envs):',
      default: 'dev.sqlite',
    });

    const dbSeedCmd = await input({ message: 'Seed command (optional, leave blank to skip):' });

    dbConfig = {
      type: 'sqlite' as const,
      service: dbService,
      env_var: dbEnvVar,
      base_file: dbBaseFile,
      ...(dbSeedCmd ? { seed_command: dbSeedCmd } : {}),
    };
  }

  const worktreeCopyRaw = await input({
    message: 'Gitignored files to copy into worktrees (comma-separated, e.g. .env,.env.local):',
    default: '.env',
  });

  const worktreeCopy = worktreeCopyRaw
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  const config: RepoctlConfig = {
    name: projectName,
    ...(description ? { description } : {}),
    env_offset: envOffset,
    services,
    ...(dbConfig ? { database: dbConfig } : {}),
    worktree_copy: worktreeCopy,
  };

  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), 'utf8');

  console.log(chalk.green(`\n  ✓ Created ${K_CONFIG_FILENAME}\n`));
  console.log(chalk.dim(`  Next step: repoctl env create <name>\n`));
}

// ✦ END init.ts

// ✦ init.ts — implements 'repoctl init' — interactive .repoctl.yaml generator

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { RepoctlConfig, ServiceConfig } from '../core/types.js';

const K_CONFIG_FILENAME = '.repoctl.yaml';

// WHAT: scans a directory for sub-directories that contain a package.json or .git
// WHY:  auto-detects likely service repos to pre-fill the services list during init
// EDGE: only looks one level deep; nested multi-level repo structures won't be detected
function detectServiceDirs(baseDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(baseDir, entry.name);
      if (
        fs.existsSync(path.join(dirPath, 'package.json')) ||
        fs.existsSync(path.join(dirPath, '.git'))
      ) {
        results.push(entry.name);
      }
      // also check one level deeper (for front-back/medallion-api style layouts)
      try {
        const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          const subPath = path.join(dirPath, sub.name);
          if (
            fs.existsSync(path.join(subPath, 'package.json')) ||
            fs.existsSync(path.join(subPath, '.git'))
          ) {
            results.push(`${entry.name}/${sub.name}`);
          }
        }
      } catch {
        // ignore unreadable sub-dirs
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

// WHAT: runs the interactive init wizard and writes .repoctl.yaml to the current directory
// WHY:  new projects need a guided setup — raw YAML editing is error-prone
// EDGE: if .repoctl.yaml already exists, prompts to overwrite rather than silently replacing it
export async function initProject(): Promise<void> {
  const { input, confirm, number, select } = await import('@inquirer/prompts');
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

  const detectedDirs = detectServiceDirs(cwd);

  const projectName = await input({
    message: 'Project name:',
    default: path.basename(cwd),
    validate: (v) => v.trim().length > 0 || 'Name is required',
  });

  const description = await input({ message: 'Description (optional):' });

  const portBase = await number({
    message: 'Base port (first service of env 0):',
    default: 3000,
  });

  const portStride = await number({
    message: 'Port stride (gap between environments):',
    default: 100,
  });

  const serviceCount = await number({
    message: 'How many services (repos)?',
    default: detectedDirs.length || 1,
    validate: (v) => (v != null && v > 0) || 'Must have at least one service',
  });

  const services: ServiceConfig[] = [];
  const count = serviceCount ?? 1;

  for (let i = 0; i < count; i++) {
    console.log(chalk.dim(`\n  Service ${i + 1} of ${count}:`));

    const suggestedRepo = detectedDirs[i] ?? '';

    const name = await input({
      message: '  Name:',
      default: suggestedRepo ? path.basename(suggestedRepo) : `service-${i}`,
      validate: (v) => v.trim().length > 0 || 'Name is required',
    });

    const repo = await input({
      message: '  Repo path (relative to project root):',
      default: suggestedRepo,
      validate: (v) => {
        if (!v.trim()) return 'Repo path is required';
        if (!fs.existsSync(path.join(cwd, v.trim()))) return `Path does not exist: ${v.trim()}`;
        return true;
      },
    });

    const startCmd = await input({
      message: '  Start command:',
      default: 'npm run dev',
      validate: (v) => v.trim().length > 0 || 'Start command is required',
    });

    const envFile = await input({ message: '  .env file name:', default: '.env' });

    services.push({ name, repo, port_offset: i, start: startCmd, env_file: envFile });
  }

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
    port_strategy: { base: portBase ?? 3000, stride: portStride ?? 100 },
    services,
    ...(dbConfig ? { database: dbConfig } : {}),
    worktree_copy: worktreeCopy,
  };

  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), 'utf8');

  console.log(chalk.green(`\n  ✓ Created ${K_CONFIG_FILENAME}\n`));
  console.log(chalk.dim(`  Next step: repoctl env create <name>\n`));
}

// ✦ END init.ts

// ✦ start.ts — implements 'repoctl env start <name>'

import path from 'path';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { loadConfig } from '../../core/config.js';
import { readManifest, writePid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';

export interface StartOptions {
  service?: string;
  configPath?: string;
}

// WHAT: spawns a single service process inside its worktree directory
// WHY:  each service runs in its isolated worktree with its own .env so ports and DB don't collide
// EDGE: process is detached and stdio is inherited; no concurrently wrapper — services start in separate terminals
function spawnService(
  name: string,
  command: string,
  cwd: string,
  port: number,
  rootDir: string,
  envName: string
): void {
  if (isPortInUse(port)) {
    console.log(chalk.yellow(`  ⚠ ${name}: port ${port} already in use — skipping`));
    return;
  }

  // Build env with PORT set - this will override what's in .env
  const spawnEnv = { ...process.env, PORT: String(port) };

  // Replace port in command string (e.g., -p 3001 -> -p 3011 or --port 3001 -> --port 3011)
  // Also inject PORT env var into the command if it's an npm run command
  let portReplacedCmd = command
    .replace(new RegExp(`-p\\s*\\d+`, 'g'), `-p ${port}`)
    .replace(new RegExp(`--port\\s*\\d+`, 'g'), `--port ${port}`);

  // If command is "npm run X", also inject PORT= so it overrides package.json
  if (portReplacedCmd.startsWith('npm run ')) {
    portReplacedCmd = `PORT=${port} ${portReplacedCmd}`;
  }

  // Use shell to properly expand the command and env vars
  const child = spawn(portReplacedCmd, {
    cwd,
    stdio: 'inherit',
    detached: true,
    env: spawnEnv,
    shell: true,
  });

  child.on('error', (err) => {
    console.error(chalk.red(`  ✗ ${name}: failed to start — ${err.message}`));
  });

  writePid(rootDir, envName, name, child.pid!);
  child.unref();

  console.log(chalk.green(`  ✓ ${name}`), chalk.dim(`(port ${port}, pid ${child.pid})`));
}

// WHAT: starts all (or one) service for an environment, running each in its worktree dir
// WHY:  env start brings up the isolated dev stack so you can actually use the environment
// EDGE: services are spawned detached and NOT tracked via concurrently — use a process manager or tmux for full control
export async function startEnv(envName: string, opts: StartOptions): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  const services = opts.service
    ? config.services.filter((s) => s.name === opts.service)
    : config.services;

  if (opts.service && services.length === 0) {
    console.error(chalk.red(`✗ Service '${opts.service}' not found in config.`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  Starting environment: ${chalk.cyan(envName)}\n`));

  for (const svc of services) {
    const svcManifest = manifest.services[svc.name];
    if (!svcManifest) {
      console.log(chalk.yellow(`  ⚠ ${svc.name}: no manifest entry — skipping`));
      continue;
    }

    if (svc.start === null) {
      console.log(chalk.dim(`  ○ ${svc.name}: no start command — skipped`));
      continue;
    }

    spawnService(
      svc.name,
      svc.start,
      svcManifest.worktree_path,
      svcManifest.port,
      rootDir,
      envName
    );
  }

  console.log();
  console.log(chalk.dim('  Services started in background. Use `repoctl env status ' + envName + '` to check.\n'));
}

// ✦ END start.ts

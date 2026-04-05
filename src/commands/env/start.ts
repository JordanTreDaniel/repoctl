// ✦ start.ts — implements 'repoctl env start <name>'

import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { loadConfig } from '../../core/config.js';
import { readManifest, writeManifest, writePid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';
import { preRunDone, runPreRunStreaming } from '../../core/pre-run.js';
import { discoverPortConfig } from '../../core/port-discovery.js';

export interface StartOptions {
  service?: string;
  configPath?: string;
  force?: boolean;
}

const K_WRAPPER_FILENAME = '.repoctl-wrapper.sh';

function stripPortFlags(command: string): string {
  let stripped = command
    .replace(/-p\s*\d+/g, '')
    .replace(/--port\s+\d+/g, '')
    .replace(/--port=\d+/g, '')
    .trim();
  stripped = stripped.replace(/\s+/g, ' ');
  return stripped;
}

function generateWrapperScript(
  serviceName: string,
  command: string,
  port: number,
  envVar: string = 'PORT'
): string {
  const strippedCommand = stripPortFlags(command);
  
  return `#!/bin/bash
# repoctl wrapper for ${serviceName} — auto-generated, do not edit manually
# This ensures port ${port} has final say over any hardcoded ports

export ${envVar}=${port}
export NODE_OPTIONS="--max-old-space-size=4096"

exec ${strippedCommand}
`;
}

function writeWrapperScript(cwd: string, serviceName: string, command: string, port: number, envVar: string = 'PORT'): void {
  const wrapperPath = path.join(cwd, K_WRAPPER_FILENAME);
  const content = generateWrapperScript(serviceName, command, port, envVar);
  fs.writeFileSync(wrapperPath, content, 'utf8');
  fs.chmodSync(wrapperPath, 0o755);
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
  envName: string,
  portInterface: 'env' | 'cli' | 'env_file' | 'script' | 'auto',
  portEnvVar: string = 'PORT'
): void {
  if (isPortInUse(port)) {
    console.log(chalk.yellow(`  ⚠ ${name}: port ${port} already in use — skipping`));
    return;
  }

  const envVar = portEnvVar || 'PORT';
  
  if (portInterface === 'auto' || portInterface === 'script' || !command) {
    writeWrapperScript(cwd, name, command, port, envVar);
    command = `bash ${K_WRAPPER_FILENAME}`;
  } else {
    writeWrapperScript(cwd, name, command, port, envVar);
    command = `bash ${K_WRAPPER_FILENAME}`;
  }

  const spawnEnv = { ...process.env, [envVar]: String(port) };

  const child = spawn(command, {
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

  // Run pre_run for all services first
  for (const svc of services) {
    const svcManifest = manifest.services[svc.name];
    if (!svcManifest) continue;
    if (svc.start === null) continue;

    const configPreRun = svc.pre_run;
    if (configPreRun === false || configPreRun === undefined) continue;

    if (!opts.force && preRunDone(svcManifest.worktree_path, configPreRun)) {
      console.log(chalk.dim(`  ⊘ ${svc.name}: pre-run already done — skipping`));
      continue;
    }

    console.log(chalk.dim(`  ⚙ ${svc.name}: running pre-run...`));
    const result = await runPreRunStreaming(svcManifest.worktree_path, configPreRun, (output) => {
      process.stdout.write(output);
    });

    if (!result.success) {
      console.error(chalk.red(`  ✗ ${svc.name}: pre-run failed — ${result.error}`));
      manifest.services[svc.name].pre_run_done = false;
      manifest.services[svc.name].pre_run_error = result.error;
      writeManifest(rootDir, manifest);
      continue;
    }

    manifest.services[svc.name].pre_run_done = true;
    writeManifest(rootDir, manifest);
    console.log(chalk.green(`  ✓ ${svc.name}: pre-run complete`));
  }

  // Now spawn all services
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

    let portInterface = svc.port_interface || 'auto';
    let portEnvVar = svc.port_env_var || 'PORT';
    
    if (portInterface === 'auto' && svc.auto_detect !== false) {
      const discovered = discoverPortConfig(svcManifest.worktree_path);
      console.log(chalk.dim(`  🔍 ${svc.name}: detected ${discovered.interface} interface (${Math.round(discovered.confidence * 100)}% confidence)`));
      if (discovered.envVar) portEnvVar = discovered.envVar;
      portInterface = discovered.interface;
    }

    spawnService(
      svc.name,
      svc.start,
      svcManifest.worktree_path,
      svcManifest.port,
      rootDir,
      envName,
      portInterface,
      portEnvVar
    );
  }

  console.log();
  console.log(chalk.dim('  Services started in background. Use `repoctl env status ' + envName + '` to check.\n'));
}

// ✦ END start.ts

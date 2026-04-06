// ✦ merge.ts — implements 'repoctl env merge <env>'

import chalk from 'chalk';
import { execSync } from 'child_process';
import path from 'path';
import { loadConfig } from '../../core/config.js';
import { readManifest } from '../../core/manifest.js';

export interface MergeOptions {
  fromBranch?: string;
  intoBranch?: string;
  service?: string;
  cherryPick?: string;
  rebase?: boolean;
  squash?: boolean;
  push?: boolean;
  noPush?: boolean;
  dryRun?: boolean;
  configPath?: string;
}

const CAREFUL_MODE = process.env.REPOCTL_CAREFUL === 'true';

interface MergeResult {
  service: string;
  repo: string;
  sourceBranch: string;
  targetBranch: string;
  status: 'success' | 'conflict' | 'error';
  message?: string;
  conflictedFiles?: string[];
}

function getTargetBranch(repoDir: string, spawningBranch?: string, override?: string): string {
  if (override) return override;
  if (spawningBranch) return spawningBranch;
  try {
    return execSync(`git -C "${repoDir}" branch --show-current`, { encoding: 'utf8' }).trim();
  } catch {
    return 'HEAD';
  }
}

function hasConflicts(repoDir: string): boolean {
  try {
    const output = execSync(`git -C "${repoDir}" status --porcelain`, { encoding: 'utf8' });
    return output.includes('UU') || output.includes('AA') || output.includes('DD');
  } catch {
    return false;
  }
}

function getConflictedFiles(repoDir: string): string[] {
  try {
    const output = execSync(`git -C "${repoDir}" diff --name-only --diff-filter=U`, { encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function printResultsTable(results: MergeResult[]): void {
  console.log(chalk.bold('\n  Merge Results:'));
  console.log(chalk.dim('  ────────────────────────────────────────────────────────────────────────────────'));
  console.log(chalk.dim('  ') + ' Service'.padEnd(20) + 'Repo'.padEnd(25) + 'Status'.padEnd(12) + 'Details');
  console.log(chalk.dim('  ────────────────────────────────────────────────────────────────────────────────'));
  
  for (const r of results) {
    const statusColor = r.status === 'success' ? chalk.green : r.status === 'conflict' ? chalk.yellow : chalk.red;
    const statusStr = r.status === 'success' ? '✓ success' : r.status === 'conflict' ? '⚠ conflict' : '✗ error';
    const details = r.conflictedFiles?.length 
      ? `${r.conflictedFiles.length} file(s)` 
      : r.message || '';
    console.log(chalk.dim('  ') + r.service.padEnd(20) + r.repo.padEnd(25) + statusColor(statusStr.padEnd(12)) + chalk.dim(details));
  }
  console.log(chalk.dim('  ────────────────────────────────────────────────────────────────────────────────'));
}

export async function mergeEnv(envName: string, opts: MergeOptions): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  const servicesToMerge = opts.service
    ? [{ name: opts.service, manifest: manifest.services[opts.service] }]
    : Object.entries(manifest.services).map(([name, svc]) => ({ name, manifest: svc }));

  const results: MergeResult[] = [];
  const defaultPush = !CAREFUL_MODE && !opts.noPush;

  console.log(chalk.bold(`\n  Merging environment: ${chalk.cyan(envName)}\n`));

  for (const { name: svcName, manifest: svcManifest } of servicesToMerge) {
    if (!svcManifest) {
      console.error(chalk.red(`✗ Service '${svcName}' not found in env '${envName}'.`));
      continue;
    }

    const worktreePath = svcManifest.worktree_path;
    const worktreeBranch = svcManifest.branch;
    const spawningBranch = svcManifest.spawning_branch;

    const svcConfig = config.services.find((s) => s.name === svcName);
    if (!svcConfig) {
      results.push({ service: svcName, repo: 'unknown', sourceBranch: worktreeBranch, targetBranch: 'unknown', status: 'error', message: 'Service not in config' });
      continue;
    }
    const repoDir = path.join(rootDir, svcConfig.repo);

    const targetBranch = getTargetBranch(repoDir, spawningBranch, opts.intoBranch);
    const sourceBranch = opts.fromBranch || worktreeBranch;

    console.log(chalk.dim(`  ${svcName}:`));
    console.log(chalk.dim(`    ${worktreeBranch} → ${targetBranch} (in ${svcConfig.repo})`));

    if (opts.dryRun) {
      console.log(chalk.yellow('    [dry-run] would merge worktree branch into target branch'));
      results.push({ service: svcName, repo: svcConfig.repo, sourceBranch, targetBranch, status: 'success', message: 'dry-run' });
      continue;
    }

    try {
      execSync(`git -C "${repoDir}" fetch origin`, { stdio: 'pipe' });
      execSync(`git -C "${worktreePath}" fetch origin`, { stdio: 'pipe' });

      execSync(`git -C "${repoDir}" checkout ${targetBranch}`, { stdio: 'pipe' });

      if (opts.cherryPick) {
        console.log(chalk.dim(`    cherry-picking ${opts.cherryPick} from worktree...`));
        execSync(`git -C "${repoDir}" cherry-pick ${opts.cherryPick}`, { stdio: 'inherit' });
      } else if (opts.squash) {
        console.log(chalk.dim(`    squash merging ${sourceBranch}...`));
        execSync(`git -C "${repoDir}" merge --squash origin/${sourceBranch}`, { stdio: 'inherit' });
        execSync(`git -C "${repoDir}" commit -m "Squash merge: ${envName} from ${sourceBranch}"`, { stdio: 'inherit' });
      } else if (opts.rebase) {
        console.log(chalk.dim(`    rebasing onto ${sourceBranch}...`));
        execSync(`git -C "${repoDir}" rebase origin/${sourceBranch}`, { stdio: 'inherit' });
      } else {
        console.log(chalk.dim(`    merging ${sourceBranch}...`));
        execSync(`git -C "${repoDir}" merge origin/${sourceBranch}`, { stdio: 'inherit' });
      }

      if (hasConflicts(repoDir)) {
        const conflicted = getConflictedFiles(repoDir);
        console.error(chalk.yellow(`    ⚠ conflicts detected:`));
        conflicted.forEach((f) => console.error(chalk.yellow(`      • ${f}`)));
        results.push({ service: svcName, repo: svcConfig.repo, sourceBranch, targetBranch, status: 'conflict', conflictedFiles: conflicted });
        continue;
      }

      console.log(chalk.green(`    ✓ merged successfully`));
      results.push({ service: svcName, repo: svcConfig.repo, sourceBranch, targetBranch, status: 'success' });

      const shouldPush = opts.push || (defaultPush && !opts.noPush);
      if (shouldPush) {
        console.log(chalk.dim(`    pushing to origin/${targetBranch}...`));
        execSync(`git -C "${repoDir}" push origin ${targetBranch}`, { stdio: 'inherit' });
        console.log(chalk.green(`    ✓ pushed`));
      } else {
        console.log(chalk.dim('    (push skipped)'));
      }
    } catch (err) {
      const msg = (err as Error).message;
      const conflicted = hasConflicts(repoDir) ? getConflictedFiles(repoDir) : [];
      if (conflicted.length > 0) {
        console.error(chalk.yellow(`    ⚠ conflicts detected:`));
        conflicted.forEach((f) => console.error(chalk.yellow(`      • ${f}`)));
        results.push({ service: svcName, repo: svcConfig.repo, sourceBranch, targetBranch, status: 'conflict', conflictedFiles: conflicted });
      } else {
        console.error(chalk.red(`    ✗ ${msg}`));
        results.push({ service: svcName, repo: svcConfig.repo, sourceBranch, targetBranch, status: 'error', message: msg });
      }
    }
  }

  printResultsTable(results);

  const conflicts = results.filter((r) => r.status === 'conflict');
  const errors = results.filter((r) => r.status === 'error');

  if (conflicts.length > 0 || errors.length > 0) {
    console.log(chalk.yellow('\n  ⚠ Merge completed with issues. Resolve conflicts and retry.\n'));
    process.exit(1);
  }

  console.log(chalk.green('\n  ✓ Merge complete.\n'));
}

// ✦ END merge.ts
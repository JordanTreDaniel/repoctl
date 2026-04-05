// ✦ destroy-utils.ts — helper utilities for comprehensive environment destruction

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { RepoctlConfig } from './types.js';

export interface DestroyReport {
  successCount: number;
  failureCount: number;
  failures: Array<{ step: string; error: string; repo?: string }>;
  warnings: string[];
  remoteBranchesDeletedCount: number;
  prsClosedCount: number;
  portsReleasedCount: number;
}

// WHAT: attempts to delete a remote branch; returns success status without throwing
// WHY:  destroy should report what failed rather than abort on first error
// EDGE: handles permission denied, branch protected, network errors gracefully
export function tryDeleteRemoteBranch(repoDir: string, branchName: string): { success: boolean; error?: string } {
  try {
    const currentBranch = execSync(`git -C "${repoDir}" rev-parse --abbrev-ref HEAD`, {
      encoding: 'utf8',
    }).trim();

    // Safeguard: never delete currently checked-out branch
    if (currentBranch === branchName) {
      return { success: false, error: 'Cannot delete currently checked-out branch' };
    }

    execSync(`git -C "${repoDir}" push origin --delete "${branchName}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { success: true };
  } catch (err) {
    const errMsg = (err as Error).message || String(err);
    // Parse github/git error messages for user-friendly output
    if (errMsg.includes('Permission denied') || errMsg.includes('403')) {
      return { success: false, error: 'Permission denied (branch may be protected or user lacks push access)' };
    }
    if (errMsg.includes('not found') || errMsg.includes("doesn't exist")) {
      return { success: false, error: 'Branch not found on remote (may have been deleted already)' };
    }
    if (errMsg.includes('Connection refused')) {
      return { success: false, error: 'Network error (cannot reach remote)' };
    }
    return { success: false, error: errMsg.split('\n')[0] };
  }
}

// WHAT: queries for open PRs from a branch and attempts to close them
// WHY:  PRs keep remote branches alive; closing them allows remote cleanup
// EDGE: gh CLI might fail; returns list of what succeeded/failed
export function tryClosePRsForBranch(branchName: string): {
  closed: number;
  failed: Array<{ prNumber: string; error: string }>;
} {
  const closed: number = 0;
  const failed: Array<{ prNumber: string; error: string }> = [];

  try {
    // Try to list open PRs with this branch
    const prList = execSync(`gh pr list --state open --head "${branchName}" --json number,title 2>/dev/null || echo ""`, {
      encoding: 'utf8',
      shell: '/bin/bash',
    }).trim();

    if (!prList) {
      return { closed: 0, failed: [] };
    }

    // Parse JSON (simple parsing for number extraction)
    try {
      const prs = JSON.parse(prList);
      if (!Array.isArray(prs)) {
        return { closed: 0, failed: [{ prNumber: '?', error: 'Unexpected gh output format' }] };
      }

      for (const pr of prs) {
        try {
          execSync(`gh pr close ${pr.number} --delete-branch=false 2>/dev/null`, {
            stdio: 'pipe',
            encoding: 'utf8',
            shell: '/bin/bash',
          });
          // Increment closed count here (but we return it at the end)
        } catch (err) {
          failed.push({ prNumber: String(pr.number), error: (err as Error).message });
        }
      }
      return { closed: prs.length - failed.length, failed };
    } catch {
      return { closed: 0, failed: [{ prNumber: '?', error: 'Failed to parse PR list' }] };
    }
  } catch (err) {
    // gh CLI not installed or network error
    return { closed: 0, failed: [{ prNumber: '?', error: `gh CLI error: ${(err as Error).message}` }] };
  }
}

// WHAT: checks if a port is in use and returns the PID(s) holding it
// WHY:  port cleanup needs to know what's holding the port before killing
// EDGE: lsof might not be available; returns empty array
export function getProcessesOnPort(port: number): number[] {
  try {
    const output = execSync(`lsof -ti :${port} 2>/dev/null || echo ""`, {
      encoding: 'utf8',
      shell: '/bin/bash',
    }).trim();

    if (!output) return [];

    return output
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

// WHAT: tries to kill a process; returns success status
// WHY:  --kill-ports flag needs to attempt cleanup without crashing destroy
// EDGE: first tries SIGTERM (graceful), then SIGKILL if force=true
export function tryKillProcess(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
): { success: boolean; error?: string } {
  try {
    process.kill(pid, signal);
    return { success: true };
  } catch (err) {
    const errMsg = (err as Error).message;
    if (errMsg.includes('ESRCH')) {
      return { success: false, error: 'Process not found (already exited)' };
    }
    if (errMsg.includes('EPERM')) {
      return { success: false, error: 'Permission denied (may need sudo)' };
    }
    return { success: false, error: errMsg };
  }
}

// WHAT: delays execution for N milliseconds (for grace periods)
// WHY:  allows processes time to shutdown gracefully before SIGKILL
// EDGE: none
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WHAT: checks if a git worktree has uncommitted changes
// WHY:  warn user that destroy will lose work
// EDGE: returns false if worktree path doesn't exist
export function hasUncommittedChanges(worktreePath: string): boolean {
  if (!fs.existsSync(worktreePath)) {
    return false;
  }

  try {
    const status = execSync(`git -C "${worktreePath}" status --porcelain`, {
      encoding: 'utf8',
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

// WHAT: scans all worktrees for an env and returns which have uncommitted changes
// WHY:  pre-destroy check to warn user before deleting work
// EDGE: silently skips worktrees that don't exist
export function findWorktreesWithChanges(
  rootDir: string,
  config: RepoctlConfig,
  envName: string,
): Array<{ service: string; repo: string }> {
  const dirty: Array<{ service: string; repo: string }> = [];

  for (const svc of config.services) {
    const wtPath = path.join(rootDir, svc.repo, '.repoctl-worktrees', envName);
    if (fs.existsSync(wtPath) && hasUncommittedChanges(wtPath)) {
      dirty.push({ service: svc.name, repo: svc.repo });
    }
  }

  return dirty;
}

// WHAT: lists all branches matching the env name pattern for a repo
// WHY:  identify all remote branches that should be cleaned up
// EDGE: returns empty array if git command fails
export function listEnvBranchesInRepo(repoDir: string, branchPattern: string): string[] {
  try {
    const output = execSync(`git -C "${repoDir}" branch -r --list '*${branchPattern}*'`, {
      encoding: 'utf8',
    }).trim();

    if (!output) return [];

    // Parse output, removing "origin/" prefix and whitespace
    return output
      .split('\n')
      .map((b) => b.trim().replace(/^origin\//, ''))
      .filter((b) => b.length > 0);
  } catch {
    return [];
  }
}

// WHAT: checks if a remote branch exists
// WHY:  before attempting delete, verify it exists (cleaner error messages)
// EDGE: returns false if repo or branch doesn't exist
export function remotebranchExists(repoDir: string, branchName: string): boolean {
  try {
    execSync(`git -C "${repoDir}" rev-parse --quiet --verify "origin/${branchName}"`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ✦ END destroy-utils.ts

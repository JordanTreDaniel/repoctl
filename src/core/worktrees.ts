// ✦ worktrees.ts — git worktree operations for creating and removing per-env worktrees

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { RepoctlConfig } from './types.js';

// WHAT: returns the worktree path for a service within an env
// WHY:  centralizes path construction so all commands refer to the same location
// EDGE: path is inside the repo's directory, not the project root
export function worktreePath(rootDir: string, svc: { repo: string }, envName: string): string {
  return path.join(rootDir, svc.repo, '.repoctl-worktrees', envName);
}

// WHAT: returns the branch name that repoctl will create for a worktree
// WHY:  consistent naming prevents collisions and makes the env source obvious in git log
// EDGE: if a branch with this name already exists, addWorktree will use it as-is
export function worktreeBranch(envName: string, svcName: string): string {
  return `repoctl/${envName}/${svcName}`;
}

// WHAT: creates a git worktree for one service within an environment
// WHY:  each worktree gives an isolated working directory with its own HEAD
// EDGE: if --branch is specified the branch is checked out, otherwise a new branch is created from HEAD
export function addWorktree(
  rootDir: string,
  svcRepo: string,
  envName: string,
  svcName: string,
  branch?: string
): { worktreePath: string; branch: string; sha: string } {
  const repoDir = path.join(rootDir, svcRepo);
  const wtPath = path.join(repoDir, '.repoctl-worktrees', envName);

  if (fs.existsSync(wtPath)) {
    throw new Error(`Worktree already exists at ${wtPath}. Destroy the env first.`);
  }

  fs.mkdirSync(path.dirname(wtPath), { recursive: true });

  const branchName = branch ?? worktreeBranch(envName, svcName);

  if (branch) {
    // checkout existing branch
    execSync(`git -C "${repoDir}" worktree add "${wtPath}" "${branch}"`, { stdio: 'inherit' });
  } else {
    // create new branch from current HEAD
    execSync(`git -C "${repoDir}" worktree add -b "${branchName}" "${wtPath}"`, {
      stdio: 'inherit',
    });
  }

  const sha = execSync(`git -C "${wtPath}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
  return { worktreePath: wtPath, branch: branchName, sha };
}

// WHAT: removes a git worktree and cleans up the worktree metadata
// WHY:  env destroy must clean up worktrees to avoid git's "already exists" errors on recreate
// EDGE: uses --force to remove even if there are uncommitted changes — warn the user before calling
export function removeWorktree(rootDir: string, svcRepo: string, envName: string): void {
  const repoDir = path.join(rootDir, svcRepo);
  const wtPath = path.join(repoDir, '.repoctl-worktrees', envName);

  if (!fs.existsSync(wtPath)) return;

  try {
    execSync(`git -C "${repoDir}" worktree remove --force "${wtPath}"`, { stdio: 'inherit' });
  } catch {
    // fallback: manually remove directory and prune
    fs.rmSync(wtPath, { recursive: true, force: true });
    execSync(`git -C "${repoDir}" worktree prune`, { stdio: 'inherit' });
  }
}

// WHAT: creates worktrees for all services in a config simultaneously
// WHY:  env create needs all worktrees set up in one operation with consistent branch names
// EDGE: if any worktree fails, previously created ones are NOT rolled back — user must destroy the env
export function addWorktreesForEnv(
  rootDir: string,
  config: RepoctlConfig,
  envName: string,
  branch?: string
): Record<string, { worktreePath: string; branch: string; sha: string }> {
  const results: Record<string, { worktreePath: string; branch: string; sha: string }> = {};
  for (const svc of config.services) {
    results[svc.name] = addWorktree(rootDir, svc.repo, envName, svc.name, branch);
  }
  return results;
}

// WHAT: removes all service worktrees for an environment
// WHY:  env destroy must clean up all repos atomically
// EDGE: silently skips repos where the worktree doesn't exist (partial create scenario)
export function removeWorktreesForEnv(
  rootDir: string,
  config: RepoctlConfig,
  envName: string
): void {
  for (const svc of config.services) {
    removeWorktree(rootDir, svc.repo, envName);
  }
}

// WHAT: reads the current HEAD SHA for a worktree
// WHY:  manifest and lock commands need up-to-date SHAs after branch checkouts
// EDGE: throws if the worktree path doesn't exist or isn't a valid git repo
export function getCurrentSha(worktreePath: string): string {
  return execSync(`git -C "${worktreePath}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
}

// WHAT: checks out a specific SHA or branch in an existing worktree
// WHY:  lock restore command needs to pin all repos to specific commits
// EDGE: this is a detached HEAD if a SHA is passed; pass a branch name to stay on a branch
export function checkoutInWorktree(wtPath: string, ref: string): void {
  execSync(`git -C "${wtPath}" checkout "${ref}"`, { stdio: 'inherit' });
}

// ✦ END worktrees.ts

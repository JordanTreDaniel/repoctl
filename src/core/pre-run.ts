// ✦ pre-run.ts — runs pre-installation/setup scripts in worktrees before starting services

import { execSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface PreRunResult {
  success: boolean;
  output: string;
  error?: string;
}

type PreRunConfig = string | string[] | boolean | undefined;

// WHAT: normalizes pre_run config to an array of commands
// WHY:  simplifies downstream logic
// EDGE: converts true to ["npm install"], false/undefined to []
function normalizePreRun(config: PreRunConfig): string[] {
  if (config === false || config === undefined) {
    return [];
  }
  if (config === true) {
    return ['npm install'];
  }
  if (config === 'always') {
    return ['npm install'];
  }
  return Array.isArray(config) ? config : [config];
}

// WHAT: checks if pre_run has already completed for a worktree
// WHY:  don't re-run npm install every time; track completion in marker file
// EDGE: returns true if marker exists and pre_run is not "always"
export function preRunDone(worktreePath: string, configPreRun: PreRunConfig): boolean {
  const markerPath = path.join(worktreePath, '.repoctl-pre-run-done');
  const commands = normalizePreRun(configPreRun);
  
  if (commands.length === 0) {
    return true;
  }
  
  if (configPreRun === 'always') {
    return false;
  }
  
  return fs.existsSync(markerPath);
}

// WHAT: runs the pre_run script(s) in a worktree
// WHY:  install dependencies, copy files, or any setup before the service starts
// EDGE: supports string (single command), array (multiple commands), or "always" (rerun each time)
export function runPreRun(worktreePath: string, configPreRun: PreRunConfig): PreRunResult {
  const commands = normalizePreRun(configPreRun);
  
  if (commands.length === 0) {
    return { success: true, output: 'Pre-run disabled' };
  }
  
  const markerPath = path.join(worktreePath, '.repoctl-pre-run-done');
  let output = '';
  
  for (const cmd of commands) {
    try {
      output += `\n$ ${cmd}\n`;
      const result = execSync(cmd, {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      output += result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      output += `\nError: ${error}`;
      return { success: false, output, error };
    }
  }
  
  if (configPreRun !== 'always') {
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
  }
  
  return { success: true, output };
}

// WHAT: runs pre_run with streaming output (for real-time feedback)
// WHY:  npm install takes time; user wants to see progress
// EDGE: returns promise that resolves when done
export function runPreRunStreaming(
  worktreePath: string,
  configPreRun: PreRunConfig,
  onOutput: (data: string) => void
): Promise<PreRunResult> {
  return new Promise((resolve) => {
    const commands = normalizePreRun(configPreRun);
    
    if (commands.length === 0) {
      resolve({ success: true, output: 'Pre-run disabled' });
      return;
    }
    
    if (configPreRun !== 'always' && preRunDone(worktreePath, configPreRun)) {
      resolve({ success: true, output: 'Pre-run already completed (marker exists)' });
      return;
    }
    
    // Always mode or no marker - run the commands
    let output = '';
    let index = 0;
    
    const runNext = () => {
      if (index >= commands.length) {
        if (configPreRun !== 'always') {
          const markerPath = path.join(worktreePath, '.repoctl-pre-run-done');
          fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
        }
        resolve({ success: true, output });
        return;
      }
      
      const cmd = commands[index++];
      onOutput(`\n[${index}/${commands.length}] $ ${cmd}\n`);
      
      const child = spawn(cmd, {
        cwd: worktreePath,
        shell: true,
      }) as ChildProcess;
      
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        onOutput(text);
      });
      
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        onOutput(text);
      });
      
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          const error = `Command exited with code ${code}`;
          onOutput(`\nError: ${error}\n`);
          resolve({ success: false, output, error });
        } else {
          runNext();
        }
      });
      
      child.on('error', (err: Error) => {
        onOutput(`\nError: ${err.message}\n`);
        resolve({ success: false, output, error: err.message });
      });
    };
    
    runNext();
  });
}

// WHAT: marks pre_run as not done (forces re-run)
// WHY:  user wants to reinstall dependencies from scratch
// EDGE: removes the marker file
export function clearPreRunMarker(worktreePath: string): void {
  const markerPath = path.join(worktreePath, '.repoctl-pre-run-done');
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath);
  }
}

// ✦ END pre-run.ts

// ✦ types.ts — shared TypeScript types for repoctl config, manifests, and runtime state

export type PortInterface = 'env' | 'cli' | 'env_file' | 'script' | 'auto' | 'unknown';

export interface ServiceConfig {
  name: string;
  repo: string;
  port: number;
  start: string | null;
  env_file?: string;
  pre_run?: string | string[] | boolean;
  port_interface?: PortInterface;
  port_env_var?: string;
  port_cli_flag?: string;
  auto_detect?: boolean;
  spawning_branch?: string;
}

export interface PortRewrite {
  service: string;
  env_var: string;
  template: string;
}

export interface DatabaseConfig {
  type: 'sqlite';
  service: string;
  env_var: string;
  base_file: string;
  seed_command?: string;
}

export interface SourceRewrite {
  service: string;
  globs: string[];
  exclude?: string[];
}

export interface RepoctlConfig {
  name: string;
  description?: string;
  env_offset: number;
  services: ServiceConfig[];
  port_rewrites?: PortRewrite[];
  source_rewrites?: SourceRewrite[];
  database?: DatabaseConfig;
  worktree_copy?: string[];
}

export interface ServiceManifest {
  port: number;
  worktree_path: string;
  branch: string;
  spawning_branch?: string;
  sha: string;
  pid?: number;
  pre_run_done?: boolean;
  pre_run_error?: string;
}

export interface EnvManifest {
  name: string;
  created: string;
  env_index: number;
  services: Record<string, ServiceManifest>;
  db_file?: string;
}

export interface KnownGoodCombo {
  name: string;
  recorded: string;
  tested: boolean;
  notes?: string;
  shas: Record<string, string>;
}

export interface KnownGoodFile {
  combos: KnownGoodCombo[];
}

export interface EnvStatus {
  name: string;
  running: boolean;
  services: Record<string, { running: boolean; port: number; pid?: number }>;
}

// ✦ END types.ts

// ✦ types.ts — shared TypeScript types for repoctl config, manifests, and runtime state

export interface ServiceConfig {
  name: string;
  repo: string;
  port_offset: number;
  start: string;
  env_file?: string;
}

export interface PortStrategy {
  base: number;
  stride: number;
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

export interface RepoctlConfig {
  name: string;
  description?: string;
  port_strategy: PortStrategy;
  services: ServiceConfig[];
  port_rewrites?: PortRewrite[];
  database?: DatabaseConfig;
  worktree_copy?: string[];
}

export interface ServiceManifest {
  port: number;
  worktree_path: string;
  branch: string;
  sha: string;
  pid?: number;
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

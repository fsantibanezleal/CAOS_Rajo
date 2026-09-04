// The display version (X.XX.XXX). The source of truth is the repository VERSION file; the guard
// scripts/check_repo_standards.py keeps VERSION, package.json and this constant in step at CI time.
// injected by vite.config.ts from the repository's VERSION file (never a literal here: a hardcoded copy
// went stale and the first deploy printed the previous version in its footer; the repo guard refuses
// a version literal in this file)
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.00.000';

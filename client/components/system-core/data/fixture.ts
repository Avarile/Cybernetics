// The bundled example arrangement.
//
// Stands in for the real data source, which is out of scope for now. The JSON
// is the reference project's own export, so it goes through the same
// normalize() every edit does rather than being trusted as already-shaped —
// that way a malformed fixture surfaces here instead of as a broken scene.

import type { Module } from './schema';
import modulesJson from './modules.json';
import { STATUS_KEYS } from './status';
import { normalize } from './schema';

interface FixtureFile {
  version: number;
  modules: unknown[];
}

export interface FixtureResult {
  modules: Module[];
  errors: string[];
}

export function loadFixture(): FixtureResult {
  const file = modulesJson as FixtureFile;
  const modules: Module[] = [];
  const errors: string[] = [];

  for (const raw of file.modules) {
    const { module, errors: problems } = normalize(raw, { statuses: STATUS_KEYS });
    if (module) {
      modules.push(module);
      continue;
    }
    errors.push(...problems);
  }

  return { modules, errors };
}

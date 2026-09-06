// The modules.json format.
//
// This is the readable, diffable form of an arrangement — one line per group,
// one block per module, so a change to a radius touches a single line. Edits in
// the control panel are in-memory only, so this is how an arrangement leaves the
// modal: serialise and copy.
//
// Defaults are left out, so a plain module stays short no matter how many
// optional fields the schema grows. Reading puts them back: normalize() fills
// in every default it finds missing, so this is lossless in both directions.

import type { FieldSpec, Module } from './schema';
import { SPEC, VERSION, GROUPS, SCALARS, groupFields } from './schema';

function isDefault(v: unknown, spec: FieldSpec): boolean {
  const d = spec.default;
  if (Array.isArray(d)) {
    return Array.isArray(v) && v.length === 0;
  }
  if (d && typeof d === 'object') {
    return !!v && typeof v === 'object' && Object.keys(v as object).length === 0;
  }
  return v === d;
}

function serializeModule(m: Module): string {
  const parts: string[] = [];
  const bag = m as unknown as Record<string, unknown>;

  for (const key of SCALARS) {
    const spec = SPEC[key] as FieldSpec;
    if (spec.required !== true && isDefault(bag[key], spec)) {
      continue;
    }
    parts.push('    "' + key + '": ' + JSON.stringify(bag[key]));
  }

  for (const g of GROUPS) {
    const src = (bag[g] || {}) as Record<string, unknown>;
    const fields = groupFields(g);
    const inner: string[] = [];
    for (const [k, spec] of Object.entries(fields)) {
      if (spec.required !== true && isDefault(src[k], spec)) {
        continue;
      }
      inner.push('"' + k + '": ' + JSON.stringify(src[k]));
    }
    // Keys this build does not know about are written back verbatim.
    for (const k of Object.keys(src)) {
      if (!(k in fields)) {
        inner.push('"' + k + '": ' + JSON.stringify(src[k]));
      }
    }
    if (inner.length) {
      parts.push('    "' + g + '": { ' + inner.join(', ') + ' }');
    }
  }

  for (const k of Object.keys(bag)) {
    if (!(k in SPEC)) {
      parts.push('    "' + k + '": ' + JSON.stringify(bag[k]));
    }
  }

  return '  {\n' + parts.join(',\n') + '\n  }';
}

export function serialize(modules: Module[]): string {
  const body = modules.map(serializeModule).join(',\n');
  return (
    '{\n  "version": ' + VERSION + ',\n  "modules": [\n' + body.replace(/^/gm, '  ') + '\n  ]\n}\n'
  );
}

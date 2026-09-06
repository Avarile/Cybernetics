// What a module is: field types, defaults, ranges, and the rules that decide
// whether a value is allowed.
//
// Everything about a module's shape is declared once, in SPEC below. Defaults,
// validation, serialisation and the control panel's form controls are all
// derived from it, so adding a field later means adding one line to SPEC —
// nothing else has to learn about it.
//
// This file has no I/O and no environment, which is what lets the scene, the
// form and the serialiser share one description of the schema instead of each
// restating it. `unknown` is load-bearing here rather than a missing type: this
// module validates untrusted input and deliberately carries keys it does not
// recognise through a round trip.
//
// A module is a nested object, grouped by concern:
//
//   { id, label, status,
//     geometry:   { radius, y, arc, band },
//     motion:     { speed, phase, lane },
//     audio:      { hz, level },
//     appearance: { color, opacity, glow, halo, trail, label, ... },
//     layout:     { visible, locked, selectable, order },
//     meta:       { description, group, tags, href, tooltip },
//     links:      { dependsOn, connections },
//     telemetry:  { progress, health, metrics } }
//
// `id` is identity: it names the meshes and keys each strip's live rotation
// across edits. `label` is display text only, so renaming what the user sees
// can never lose a module.

export const VERSION = 2;

/* ---- schema types ---- */

export type Kind =
  | 'id'
  | 'text'
  | 'enum'
  | 'num'
  | 'int'
  | 'bool'
  | 'color'
  | 'strings'
  | 'ids'
  | 'nummap';

export type Control =
  | 'text'
  | 'number'
  | 'toggle'
  | 'status'
  | 'color'
  | 'list'
  | 'pairs'
  | 'phase';

export interface UiSpec {
  control: Control;
  label: string;
  wide?: boolean;
  step?: number;
}

export interface FieldSpec {
  kind: Kind;
  required?: boolean;
  /** Used when the key is absent, and omitted again on save. */
  default?: unknown;
  /** Required fields start here — zero is outside most of their ranges. */
  initial?: number;
  /** null is a legal value distinct from the default. */
  nullable?: boolean;
  min?: number;
  max?: number;
  ui: UiSpec;
}

export interface GroupSpec {
  title: string;
  open?: boolean;
  fields: Record<string, FieldSpec>;
}

export type SpecEntry = FieldSpec | GroupSpec;

/** A grouped section, rather than a scalar sitting at the top of a module. */
export function isGroup(s: SpecEntry): s is GroupSpec {
  return (s as GroupSpec).fields !== undefined;
}

/** A module as this build understands it, plus whatever it does not. */
export interface Module {
  id: string;
  label: string | null;
  status: string;
  geometry: { radius: number; y: number; arc: number; band: number } & Record<string, unknown>;
  motion: { speed: number; phase: number | null; lane: number | null } & Record<string, unknown>;
  audio: { hz: number | null; level: number } & Record<string, unknown>;
  appearance: {
    color: string | null;
    opacity: number | null;
    glow: boolean;
    halo: boolean;
    trail: boolean;
    label: string | null;
    labelVisible: boolean;
    labelScale: number;
  } & Record<string, unknown>;
  layout: { visible: boolean; locked: boolean; selectable: boolean; order: number | null } & Record<
    string,
    unknown
  >;
  meta: {
    description: string;
    group: string;
    tags: string[];
    href: string | null;
    tooltip: string | null;
  } & Record<string, unknown>;
  links: { dependsOn: string[]; connections: string[] } & Record<string, unknown>;
  telemetry: {
    progress: number | null;
    health: number | null;
    metrics: Record<string, number>;
  } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface Opts {
  /** Known status keys, to validate `status` against. */
  statuses?: string[];
}

/**
 * The shape of a module, in the order it is written back.
 *
 * kind      how the value is checked and coerced (see check() below)
 * required  must be present; no default is substituted
 * default   used when the key is absent, and omitted again on save
 * nullable  null is a legal value distinct from the default
 * min/max   inclusive bounds for num/int
 * ui        how the control panel renders it: control type and label
 */
export const SPEC: Record<string, SpecEntry> = {
  id: { kind: 'id', required: true, ui: { control: 'text', label: 'ID', wide: true } },
  label: {
    kind: 'text',
    default: null,
    nullable: true,
    ui: { control: 'text', label: 'Label', wide: true },
  },
  status: { kind: 'enum', required: true, ui: { control: 'status', label: 'Status', wide: true } },

  geometry: {
    title: 'Geometry',
    open: true,
    fields: {
      radius: {
        kind: 'num',
        required: true,
        initial: 0.95,
        min: 0.01,
        max: 8,
        ui: { control: 'number', label: 'Radius', step: 0.02 },
      },
      y: {
        kind: 'num',
        required: true,
        initial: 0,
        min: -8,
        max: 8,
        ui: { control: 'number', label: 'Height', step: 0.05 },
      },
      arc: {
        kind: 'num',
        required: true,
        initial: 180,
        min: 1,
        max: 360,
        ui: { control: 'number', label: 'Arc °', step: 5 },
      },
      band: {
        kind: 'num',
        required: true,
        initial: 0.05,
        min: 0.002,
        max: 2,
        ui: { control: 'number', label: 'Band', step: 0.005 },
      },
    },
  },

  motion: {
    title: 'Motion',
    fields: {
      speed: {
        kind: 'num',
        required: true,
        initial: 0.08,
        min: -10,
        max: 10,
        ui: { control: 'number', label: 'Speed', step: 0.01 },
      },
      // null means "pick one at load time". A number pins the strip's starting
      // angle, so a saved arrangement reloads exactly as it was left.
      phase: {
        kind: 'num',
        default: null,
        nullable: true,
        min: 0,
        max: 6.2832,
        ui: { control: 'phase', label: 'Phase', step: 0.01 },
      },
      // null means "next free scanner lane". A number fixes the contact's ring.
      lane: {
        kind: 'int',
        default: null,
        nullable: true,
        min: 0,
        max: 4,
        ui: { control: 'number', label: 'Lane', step: 1 },
      },
    },
  },

  audio: {
    title: 'Audio',
    fields: {
      // Centre of the roar's lowest band; the other two sit at multiples of
      // it, so this is the one number that decides how big the thing sounds.
      // null is silent, and it is the off switch: a module either has a
      // frequency or makes no sound, so there is no separate toggle to keep in
      // agreement with it.
      hz: {
        kind: 'num',
        default: null,
        nullable: true,
        min: 20,
        max: 400,
        ui: { control: 'number', label: 'Rumble Hz', step: 1 },
      },
      // A fraction of the one ceiling in scene/tone.ts, not an absolute
      // amplitude. There is no mute control, so how loud this can ever get is
      // decided once, there, rather than per module here.
      level: {
        kind: 'num',
        default: 0.5,
        min: 0,
        max: 1,
        ui: { control: 'number', label: 'Roar level', step: 0.05 },
      },
    },
  },

  appearance: {
    title: 'Appearance',
    fields: {
      color: {
        kind: 'color',
        default: null,
        nullable: true,
        ui: { control: 'color', label: 'Colour override' },
      },
      opacity: {
        kind: 'num',
        default: null,
        nullable: true,
        min: 0,
        max: 1,
        ui: { control: 'number', label: 'Opacity', step: 0.05 },
      },
      glow: { kind: 'bool', default: true, ui: { control: 'toggle', label: 'Glow' } },
      halo: { kind: 'bool', default: true, ui: { control: 'toggle', label: 'Halo' } },
      trail: { kind: 'bool', default: true, ui: { control: 'toggle', label: 'Trail' } },
      label: {
        kind: 'text',
        default: null,
        nullable: true,
        ui: { control: 'text', label: 'Band text', wide: true },
      },
      labelVisible: {
        kind: 'bool',
        default: true,
        ui: { control: 'toggle', label: 'Show band text' },
      },
      labelScale: {
        kind: 'num',
        default: 1,
        min: 0.2,
        max: 4,
        ui: { control: 'number', label: 'Text scale', step: 0.05 },
      },
    },
  },

  layout: {
    title: 'Layout',
    fields: {
      visible: { kind: 'bool', default: true, ui: { control: 'toggle', label: 'Visible' } },
      locked: { kind: 'bool', default: false, ui: { control: 'toggle', label: 'Locked' } },
      selectable: { kind: 'bool', default: true, ui: { control: 'toggle', label: 'Selectable' } },
      order: {
        kind: 'num',
        default: null,
        nullable: true,
        ui: { control: 'number', label: 'Sort order', step: 1 },
      },
    },
  },

  meta: {
    title: 'Metadata',
    fields: {
      description: {
        kind: 'text',
        default: '',
        ui: { control: 'text', label: 'Description', wide: true },
      },
      group: { kind: 'text', default: '', ui: { control: 'text', label: 'Group', wide: true } },
      tags: { kind: 'strings', default: [], ui: { control: 'list', label: 'Tags', wide: true } },
      href: {
        kind: 'text',
        default: null,
        nullable: true,
        ui: { control: 'text', label: 'Link URL', wide: true },
      },
      tooltip: {
        kind: 'text',
        default: null,
        nullable: true,
        ui: { control: 'text', label: 'Tooltip', wide: true },
      },
    },
  },

  links: {
    title: 'Relationships',
    fields: {
      dependsOn: {
        kind: 'ids',
        default: [],
        ui: { control: 'list', label: 'Depends on', wide: true },
      },
      connections: {
        kind: 'ids',
        default: [],
        ui: { control: 'list', label: 'Connections', wide: true },
      },
    },
  },

  telemetry: {
    title: 'Telemetry',
    fields: {
      progress: {
        kind: 'num',
        default: null,
        nullable: true,
        min: 0,
        max: 1,
        ui: { control: 'number', label: 'Progress', step: 0.05 },
      },
      health: {
        kind: 'num',
        default: null,
        nullable: true,
        min: 0,
        max: 1,
        ui: { control: 'number', label: 'Health', step: 0.05 },
      },
      metrics: {
        kind: 'nummap',
        default: {},
        ui: { control: 'pairs', label: 'Metrics', wide: true },
      },
    },
  },
};

// The grouped sections, in write order. Anything else in SPEC is a scalar that
// lives at the top level of a module. A new group is a new nested object and a
// new scalar is a new field — neither needs anything but its line in SPEC.
export const GROUPS = Object.keys(SPEC).filter((k) => isGroup(SPEC[k]));
export const SCALARS = Object.keys(SPEC).filter((k) => !isGroup(SPEC[k]));

/** The fields of a group, by name. */
export function groupFields(g: string): Record<string, FieldSpec> {
  const s = SPEC[g];
  return isGroup(s) ? s.fields : {};
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Is this a real number, or something JS would quietly turn into one?
 *
 * Number.isFinite(+v) alone is not enough, and the gap is not academic: +null,
 * +'' and +[] are all 0, and +true is 1. Clearing a numeric input produces NaN,
 * which JSON.stringify writes as null — so a bare coercion check would read
 * that null back as a legitimate 0 and move the module with no warning at all.
 * Only a number, or a string that is entirely a number, counts.
 */
export function isNum(v: unknown): boolean {
  if (typeof v === 'number') {
    return Number.isFinite(v);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    return Number.isFinite(+v);
  }
  return false;
}

type CheckResult = { value: unknown; error?: never } | { value?: never; error: string };

/** Check one value against its spec entry: the coerced value, or why not. */
function check(v: unknown, spec: FieldSpec, opts: Opts): CheckResult {
  if (v === null && (spec.nullable === true || spec.default === null)) {
    return { value: null };
  }

  switch (spec.kind) {
    case 'id':
      if (typeof v !== 'string' || !ID_RE.test(v.trim())) {
        return {
          error: 'must be an id: letters, digits, then . _ - (got ' + JSON.stringify(v) + ')',
        };
      }
      return { value: v.trim() };

    case 'text':
      if (typeof v !== 'string') {
        return { error: 'must be text (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v };

    case 'enum': {
      const allowed = opts.statuses;
      if (typeof v !== 'string' || (allowed && !allowed.includes(v))) {
        return {
          error:
            'must be one of ' +
            (allowed ? allowed.join(', ') : 'the known statuses') +
            ' (got ' +
            JSON.stringify(v) +
            ')',
        };
      }
      return { value: v };
    }

    case 'num':
    case 'int': {
      if (!isNum(v)) {
        return { error: 'must be a number (got ' + JSON.stringify(v) + ')' };
      }
      const n = +(v as number | string);
      if (spec.kind === 'int' && !Number.isInteger(n)) {
        return { error: 'must be a whole number (got ' + n + ')' };
      }
      if (spec.min != null && n < spec.min) {
        return { error: 'must be at least ' + spec.min + ' (got ' + n + ')' };
      }
      if (spec.max != null && n > spec.max) {
        return { error: 'must be at most ' + spec.max + ' (got ' + n + ')' };
      }
      return { value: n };
    }

    case 'bool':
      if (typeof v !== 'boolean') {
        return { error: 'must be true or false (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v };

    case 'color':
      if (typeof v !== 'string' || !HEX_RE.test(v.trim())) {
        return { error: 'must be a hex colour like #E4A025 (got ' + JSON.stringify(v) + ')' };
      }
      return { value: v.trim().toUpperCase() };

    case 'strings': {
      if (!Array.isArray(v)) {
        return { error: 'must be a list (got ' + JSON.stringify(v) + ')' };
      }
      const out: string[] = [];
      for (const s of v) {
        if (typeof s !== 'string' || !s.trim()) {
          return { error: 'list entries must be non-empty text' };
        }
        if (!out.includes(s.trim())) {
          out.push(s.trim());
        }
      }
      return { value: out };
    }

    case 'ids': {
      if (!Array.isArray(v)) {
        return { error: 'must be a list of ids (got ' + JSON.stringify(v) + ')' };
      }
      const out: string[] = [];
      for (const s of v) {
        if (typeof s !== 'string' || !ID_RE.test(s.trim())) {
          return { error: 'list entries must be ids' };
        }
        if (!out.includes(s.trim())) {
          out.push(s.trim());
        }
      }
      return { value: out };
    }

    case 'nummap': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { error: 'must be an object of name -> number' };
      }
      const src = v as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const k of Object.keys(src)) {
        if (!isNum(src[k])) {
          return { error: '"' + k + '" must be a number (got ' + JSON.stringify(src[k]) + ')' };
        }
        out[k] = +(src[k] as number | string);
      }
      return { value: out };
    }

    default:
      return { error: 'unknown field kind "' + spec.kind + '"' };
  }
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.slice() as T;
  }
  if (v && typeof v === 'object') {
    return { ...(v as object) } as T;
  }
  return v;
}

/**
 * A module with every field at its default, ready to be filled in.
 * Required fields take their declared `initial` — zero would be outside the
 * permitted range for most of them, so a blank module has to start valid.
 */
export function blankModule(id: string, status: string): Module {
  const m: Record<string, unknown> = { id, label: null, status };
  for (const g of GROUPS) {
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(groupFields(g))) {
      out[k] = spec.required === true ? spec.initial : clone(spec.default);
    }
    m[g] = out;
  }
  return m as Module;
}

/**
 * Fill in defaults and coerce what is there, keeping anything unrecognised.
 *
 * Unknown keys are carried through rather than dropped: a module written by a
 * later build must survive a read/write here without quietly losing the fields
 * this one does not understand yet.
 */
export function normalize(
  raw: unknown,
  opts: Opts = {},
): { module: Module | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { module: null, errors: ['is not an object'] };
  }

  const src0 = raw as Record<string, unknown>;
  const who = typeof src0.id === 'string' && src0.id.trim() ? src0.id.trim() : '(no id)';
  const out: Record<string, unknown> = {};

  for (const key of SCALARS) {
    const spec = SPEC[key] as FieldSpec;
    if (src0[key] === undefined) {
      if (spec.required === true) {
        errors.push(who + ': ' + key + ' is missing');
      } else {
        out[key] = clone(spec.default);
      }
      continue;
    }
    const r = check(src0[key], spec, opts);
    if (r.error != null) {
      errors.push(who + ': ' + key + ' ' + r.error);
    } else {
      out[key] = r.value;
    }
  }

  for (const g of GROUPS) {
    const rawGroup = src0[g];
    const src = rawGroup === undefined || rawGroup === null ? {} : rawGroup;
    if (typeof src !== 'object' || Array.isArray(src)) {
      errors.push(who + ': ' + g + ' must be an object');
      continue;
    }
    const bag = src as Record<string, unknown>;
    const fields = groupFields(g);
    const dst: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(fields)) {
      if (bag[k] === undefined) {
        if (spec.required === true) {
          errors.push(who + ': ' + g + '.' + k + ' is missing');
        } else {
          dst[k] = clone(spec.default);
        }
        continue;
      }
      const r = check(bag[k], spec, opts);
      if (r.error != null) {
        errors.push(who + ': ' + g + '.' + k + ' ' + r.error);
      } else {
        dst[k] = r.value;
      }
    }
    // Unrecognised keys inside a known group.
    for (const k of Object.keys(bag)) {
      if (!(k in fields)) {
        dst[k] = clone(bag[k]);
      }
    }
    out[g] = dst;
  }

  // Unrecognised groups / top-level keys.
  for (const k of Object.keys(src0)) {
    if (!(k in SPEC)) {
      out[k] = clone(src0[k]);
    }
  }

  return { module: errors.length ? null : (out as Module), errors };
}

/** What the panel should show for a module: its label, or its id. */
export function displayName(m: Module): string {
  return (m.label && m.label.trim()) || m.id;
}

/** What should be printed on the band: the override, else the display name. */
export function bandText(m: Module): string {
  const o = m.appearance && m.appearance.label;
  return (o && o.trim()) || displayName(m);
}

/**
 * An id not already in `taken`, by appending -2, -3, … as needed.
 * Duplicates are the one thing the store cannot carry: ids name the meshes and
 * key each strip's live rotation across edits.
 */
export function uniqueId(base: string, taken: Set<string>): string {
  const cleaned = String(base)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+/, '');
  const root = ID_RE.test(cleaned) ? cleaned : 'module';
  if (!taken.has(root)) {
    return root;
  }
  for (let n = 2; ; n++) {
    const candidate = root + '-' + n;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Check modules before they can reach the store.
 *
 * The same rules as reading, applied in the other direction. Writing an invalid
 * module is worse than reading one: JSON.stringify turns NaN into null, so the
 * bad value survives in a form the reader has to guess about.
 *
 * @returns problems found; empty means safe to write
 */
export function verify(modules: unknown[], opts: Opts = {}): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    const { errors } = normalize(m, opts);
    problems.push(...errors);
    const id = m && (m as Module).id;
    if (typeof id === 'string') {
      if (seen.has(id)) {
        problems.push('two modules share the id "' + id + '"');
      }
      seen.add(id);
    }
  }
  return problems;
}

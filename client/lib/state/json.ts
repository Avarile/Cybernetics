/**
 * The shape anything persisted must have.
 *
 * Window props are typed as `JsonObject` so that putting a callback in them is a
 * compile error rather than a silent `JSON.stringify` drop — which is exactly
 * how a restored window would otherwise come back with a missing handler and no
 * error anywhere.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

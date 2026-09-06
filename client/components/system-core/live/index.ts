// The live-data layer: the snapshot's binding to the scene's appearance.
//
// `adapt` turns the wire format into what the scene consumes; `bind` turns that
// into appearance. Both are free of `three`, of React and of any I/O, because
// ../scene/resolve.ts imports them and has to stay out of the eager bundle.

export * from './adapt';
export * from './bind';

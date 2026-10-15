/**
 * The sun never moves, so the shadow map only needs re-rendering when objects
 * move: buildings rising, sinking or lifting. Anything that animates calls
 * `markShadowsDirty()` and the Scene refreshes the map on the next frame.
 * Idle frames skip the shadow pass entirely.
 */
let dirtyFrames = 2;

export function markShadowsDirty(frames = 1) {
  dirtyFrames = Math.max(dirtyFrames, frames);
}

export function consumeShadowDirty(): boolean {
  if (dirtyFrames <= 0) return false;
  dirtyFrames--;
  return true;
}

/* Unique id generation.

   Never use Date.now() for ids: two records created in the same
   millisecond collide, and "update by id" then corrupts both. This
   actually happened - saving a game wrote one pitch record per pitcher
   in a tight loop, all sharing one timestamp id, and ending a counted
   inning overwrote every pitcher's workload. */

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

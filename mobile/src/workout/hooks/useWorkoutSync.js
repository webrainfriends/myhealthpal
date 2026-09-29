import { useCallback, useRef } from 'react';
import { recordWorkoutSets } from '../../api/client';

// Batched, retry-safe upload of finished sets. Sets are held in memory until
// the server accepts them; the server is idempotent on the client ids, so a
// retry after a dropped connection can't duplicate anything. The live loop
// never waits on this.
export default function useWorkoutSync(workoutId) {
  const pending = useRef([]);
  const inFlight = useRef(null);

  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current.catch(() => {});
    if (pending.current.length === 0) return true;
    const batch = pending.current.slice();
    inFlight.current = recordWorkoutSets(workoutId, batch);
    try {
      await inFlight.current;
      pending.current = pending.current.filter((s) => !batch.includes(s));
      return true;
    } catch (err) {
      return false;
    } finally {
      inFlight.current = null;
    }
  }, [workoutId]);

  const enqueue = useCallback((sets) => {
    for (const set of sets) if (!pending.current.some((p) => p.clientId === set.clientId)) pending.current.push(set);
  }, []);

  return { enqueue, flush };
}

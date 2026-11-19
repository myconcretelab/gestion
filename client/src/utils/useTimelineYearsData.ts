import { useEffect, useRef, useState } from "react";

export function useTimelineYearsData<T>(
  years: number[],
  revision: number,
  enabled: boolean,
  fetchYear: (year: number, signal: AbortSignal) => Promise<T>,
) {
  const cache = useRef(new Map<number, number>());
  const load = useRef(fetchYear);
  const [data, setData] = useState<Record<number, T>>({});
  const [errors, setErrors] = useState<Record<number, boolean>>({});
  const yearsKey = years.join(",");
  useEffect(() => {
    load.current = fetchYear;
  }, [fetchYear]);
  useEffect(() => {
    if (!enabled || !yearsKey) return;
    const controller = new AbortController();
    const missing = yearsKey
      .split(",")
      .map(Number)
      .filter((year) => cache.current.get(year) !== revision);
    for (const year of missing) {
      void load
        .current(year, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          cache.current.set(year, revision);
          setData((previous) => ({ ...previous, [year]: value }));
          setErrors((previous) =>
            previous[year] ? { ...previous, [year]: false } : previous,
          );
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setErrors((previous) => ({ ...previous, [year]: true }));
        });
    }
    return () => controller.abort();
  }, [enabled, revision, yearsKey]);

  return { data, errors };
}

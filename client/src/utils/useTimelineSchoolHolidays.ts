import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import {
  monthRangeDates,
  monthsInRange,
  type MonthRange,
} from "./monthTimeline";
import type { SchoolHoliday } from "./schoolHolidays";

export function useTimelineSchoolHolidays(range: MonthRange | null) {
  const [holidays, setHolidays] = useState<SchoolHoliday[]>([]);
  const loaded = useRef(new Set<number>());
  useEffect(() => {
    if (!range) return;
    const missing = monthsInRange(range).filter(
      (key) => !loaded.current.has(key),
    );
    const batches: MonthRange[] = [];
    for (const key of missing) {
      const batch = batches.at(-1);
      if (batch && batch.last + 1 === key) batch.last = key;
      else batches.push({ first: key, last: key });
    }
    const controller = new AbortController();
    for (const batch of batches) {
      const query = new URLSearchParams({
        ...monthRangeDates(batch),
        zone: "B",
      });
      void apiFetch<SchoolHoliday[]>(`/school-holidays?${query}`, {
        signal: controller.signal,
      })
        .then((rows) => {
          if (controller.signal.aborted) return;
          monthsInRange(batch).forEach((key) => loaded.current.add(key));
          setHolidays((previous) => [
            ...new Map(
              [...previous, ...rows].map((item) => [
                `${item.start}:${item.end}:${item.description}:${item.population}`,
                item,
              ]),
            ).values(),
          ]);
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [range]);
  return holidays;
}

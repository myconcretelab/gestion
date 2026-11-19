import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MAX_TIMELINE_MONTH,
  MIN_TIMELINE_MONTH,
  timelineMonthIsValid,
  type MonthRange,
} from "./monthTimeline";

const BATCH_SIZE = 3;
type LoadMode = "replace" | "extend" | "refresh";
type LoadMonths = (
  range: MonthRange,
  mode: LoadMode,
  signal: AbortSignal,
) => Promise<void>;
type Options = {
  initialMonth: number;
  monthsBefore: number;
  loadMonths: LoadMonths;
  listRef: RefObject<HTMLElement | null>;
  scrollRef?: RefObject<HTMLElement | null>;
  stickyOffset: number;
  autoPaging: boolean;
};

export function useMonthTimeline({
  initialMonth,
  monthsBefore,
  loadMonths,
  listRef,
  scrollRef,
  stickyOffset,
  autoPaging,
}: Options) {
  const [range, setRange] = useState<MonthRange | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rangeRef = useRef<MonthRange | null>(null);
  const initial = useRef(initialMonth);
  const load = useRef(loadMonths);
  const offset = useRef(stickyOffset);
  const controllerRef = useRef<AbortController | null>(null);
  const opening = useRef<{
    range: MonthRange;
    promise: Promise<boolean>;
  } | null>(null);
  const restoreAnchor = useRef<{ element: HTMLElement; top: number } | null>(
    null,
  );
  const retryRef = useRef<(() => Promise<boolean>) | null>(null);

  useLayoutEffect(() => {
    load.current = loadMonths;
    offset.current = stickyOffset;
  }, [loadMonths, stickyOffset]);

  const request = useCallback(
    async (target: MonthRange, batch: MonthRange, mode: LoadMode) => {
      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        await load.current(batch, mode, controller.signal);
        if (controller.signal.aborted) return false;

        if (mode === "extend" && target.first !== rangeRef.current?.first) {
          const scrollTop =
            scrollRef?.current?.getBoundingClientRect().top ?? 0;
          const sections = listRef.current?.querySelectorAll<HTMLElement>(
            "[data-timeline-month]",
          );
          const element =
            sections &&
            Array.from(sections).find(
              (section) =>
                section.getBoundingClientRect().bottom >
                scrollTop + offset.current,
            );
          if (element)
            restoreAnchor.current = {
              element,
              top: element.getBoundingClientRect().top,
            };
        }

        rangeRef.current = target;
        setRange(target);
        return true;
      } catch (failure) {
        if (!controller.signal.aborted) {
          retryRef.current = () => request(target, batch, mode);
          setError(
            failure instanceof Error
              ? failure.message
              : "Chargement des mois impossible.",
          );
        }
        return false;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setBusy(false);
        }
      }
    },
    [listRef, scrollRef],
  );

  const open = useCallback(
    (key: number) => {
      if (!timelineMonthIsValid(key)) return Promise.resolve(false);
      const current = rangeRef.current;
      const pending = opening.current;
      if (pending && key >= pending.range.first && key <= pending.range.last)
        return pending.promise;
      if (current && key >= current.first && key <= current.last) {
        if (pending) controllerRef.current?.abort();
        return Promise.resolve(true);
      }
      const target = {
        first: Math.max(MIN_TIMELINE_MONTH, key - monthsBefore),
        last: Math.min(MAX_TIMELINE_MONTH, key + BATCH_SIZE),
      };
      const promise = request(target, target, "replace");
      opening.current = { range: target, promise };
      void promise.finally(() => {
        if (opening.current?.promise === promise) opening.current = null;
      });
      return promise;
    },
    [monthsBefore, request],
  );

  const refresh = useCallback(() => {
    const current = rangeRef.current;
    return current
      ? request(current, current, "refresh")
      : open(initial.current);
  }, [open, request]);

  const extend = useCallback(
    (direction: -1 | 1) => {
      const current = rangeRef.current;
      if (!current || controllerRef.current) return;
      const batch =
        direction < 0
          ? {
              first: Math.max(MIN_TIMELINE_MONTH, current.first - BATCH_SIZE),
              last: current.first - 1,
            }
          : {
              first: current.last + 1,
              last: Math.min(MAX_TIMELINE_MONTH, current.last + BATCH_SIZE),
            };
      if (batch.first > batch.last) return;
      void request(
        {
          first: Math.min(batch.first, current.first),
          last: Math.max(batch.last, current.last),
        },
        batch,
        "extend",
      );
    },
    [request],
  );

  useEffect(() => {
    void open(initial.current);
    return () => {
      opening.current = null;
      controllerRef.current?.abort();
    };
  }, [open]);

  useLayoutEffect(() => {
    const anchor = restoreAnchor.current;
    if (!anchor) return;
    restoreAnchor.current = null;
    if (!anchor.element.isConnected) return;
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1)
      (scrollRef?.current ?? window).scrollBy({
        top: delta,
        behavior: "instant",
      });
  }, [range, scrollRef]);

  useEffect(() => {
    if (!range || busy || error || !autoPaging) return;
    const scroll = scrollRef?.current;
    const target = scroll ?? window;
    const getTop = () => scroll?.scrollTop ?? window.scrollY;
    let previousTop = getTop();
    const onScroll = () => {
      const top = getTop();
      const delta = top - previousTop;
      previousTop = top;
      if (!delta || controllerRef.current) return;
      const list = listRef.current?.getBoundingClientRect();
      if (!list) return;
      const viewport = scroll?.getBoundingClientRect();
      if (delta < 0 && list.top > (viewport?.top ?? 0) - 250) extend(-1);
      if (
        delta > 0 &&
        list.bottom < (viewport?.bottom ?? window.innerHeight) + 500
      )
        extend(1);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [autoPaging, busy, error, extend, listRef, range, scrollRef]);

  return {
    range,
    busy,
    error,
    open,
    refresh,
    extend,
    retry: () => {
      void retryRef.current?.();
    },
    hasPrevious: range !== null && range.first > MIN_TIMELINE_MONTH,
    hasNext: range !== null && range.last < MAX_TIMELINE_MONTH,
  };
}

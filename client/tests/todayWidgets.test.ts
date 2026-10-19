import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TODAY_WIDGET_PREFERENCES,
  getNextTrashCollectionOccurrence,
  getTrashCollectionColor,
  moveTodayWidget,
  normalizeTodayWidgetPreferences,
} from "../src/utils/todayWidgets.ts";

test("today widgets restore missing widgets and reject invalid values", () => {
  const normalized = normalizeTodayWidgetPreferences({
    order: ["revenue", "trash", "unknown", "revenue"],
    widgets: {
      trash: { enabled: false, width: "large" },
      revenue: { enabled: true, width: "giant" },
    },
    options: { trash: { showNextPickup: false } },
  });

  assert.deepEqual(normalized.order, ["revenue", "trash", "occupancy", "hours", "notification_archive"]);
  assert.deepEqual(normalized.widgets.trash, { enabled: false, width: "large" });
  assert.equal(normalized.widgets.revenue.width, "full");
  assert.equal(normalized.widgets.hours.enabled, true);
  assert.equal(normalized.options.trash.showNextPickup, false);
  assert.equal(normalized.options.occupancy.showCount, true);
  assert.equal(normalized.options.trash.collections.length, 2);
  assert.deepEqual(normalized.options.revenue.visibleMetrics, ["previous_month", "current_month", "next_month", "last_24_months"]);
});

test("today widgets move relative to other installed widgets", () => {
  const preferences = normalizeTodayWidgetPreferences({
    ...DEFAULT_TODAY_WIDGET_PREFERENCES,
    widgets: {
      ...DEFAULT_TODAY_WIDGET_PREFERENCES.widgets,
      occupancy: { ...DEFAULT_TODAY_WIDGET_PREFERENCES.widgets.occupancy, enabled: false },
    },
  });

  const moved = moveTodayWidget(preferences, "hours", -1);
  assert.deepEqual(moved.order.slice(0, 3), ["hours", "occupancy", "trash"]);
  assert.equal(moveTodayWidget(moved, "hours", -1), moved);
});

test("trash collections calculate weekly periods, cut-off times and alternating colors", () => {
  const collection = {
    id: "yellow-bin",
    name: "Bac jaune",
    color: "#FFCB05",
    alternateColor: "#104911",
    frequencyWeeks: 2,
    weekday: 3,
    startDate: "2026-10-07",
    switchHour: 16,
  };

  const beforeCutoff = getNextTrashCollectionOccurrence(collection, new Date(2026, 9, 7, 10));
  const afterCutoff = getNextTrashCollectionOccurrence(collection, new Date(2026, 9, 7, 18));
  const localDate = (value: Date | null) => value
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : null;

  assert.equal(localDate(beforeCutoff), "2026-10-07");
  assert.equal(localDate(afterCutoff), "2026-10-21");
  assert.equal(beforeCutoff && getTrashCollectionColor(collection, beforeCutoff), "#FFCB05");
  assert.equal(afterCutoff && getTrashCollectionColor(collection, afterCutoff), "#104911");
});

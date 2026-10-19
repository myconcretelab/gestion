import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TODAY_WIDGET_PREFERENCES,
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

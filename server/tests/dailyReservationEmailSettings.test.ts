import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultDailyReservationEmailConfig,
  mergeDailyReservationEmailConfig,
  normalizeDailyReservationEmailConfig,
  type DailyReservationEmailConfig,
} from "../src/services/dailyReservationEmailSettings.ts";

test("normalizeDailyReservationEmailConfig nettoie les emails et borne l'horaire", () => {
  const fallback = buildDefaultDailyReservationEmailConfig();

  const config = normalizeDailyReservationEmailConfig(
    {
      enabled: "true" as unknown as boolean,
      recipients: [
        {
          email: "ADMIN@example.com ",
          enabled: true,
          send_if_empty: true,
        },
        {
          email: "admin@example.com",
          enabled: false,
          send_if_empty: false,
        },
        {
          email: " owner@example.com",
          enabled: false,
          send_if_empty: true,
        },
        {
          email: "invalide",
          enabled: true,
          send_if_empty: false,
        },
      ],
      hour: 42 as unknown as number,
      minute: -5 as unknown as number,
    },
    fallback,
  );

  assert.deepEqual(config, {
    enabled: true,
    recipients: [
      {
        email: "admin@example.com",
        enabled: true,
        send_if_empty: true,
      },
      {
        email: "owner@example.com",
        enabled: false,
        send_if_empty: true,
      },
    ],
    hour: fallback.hour,
    minute: fallback.minute,
  });
});

test("mergeDailyReservationEmailConfig conserve les valeurs existantes non surchargees", () => {
  const current: DailyReservationEmailConfig = {
    enabled: true,
    recipients: [
      {
        email: "contact@example.com",
        enabled: true,
        send_if_empty: false,
      },
    ],
    hour: 8,
    minute: 15,
  };

  const config = mergeDailyReservationEmailConfig(current, {
    recipients: [
      {
        email: "contact@example.com",
        enabled: true,
        send_if_empty: true,
      },
    ],
    minute: 45,
  });

  assert.deepEqual(config, {
    enabled: true,
    recipients: [
      {
        email: "contact@example.com",
        enabled: true,
        send_if_empty: true,
      },
    ],
    hour: 8,
    minute: 45,
  });
});

test("normalizeDailyReservationEmailConfig migre l'ancien format global vers des reglages par email", () => {
  const fallback = buildDefaultDailyReservationEmailConfig();

  const config = normalizeDailyReservationEmailConfig(
    {
      enabled: true,
      recipients: ["one@example.com", "two@example.com"] as unknown as never[],
      send_if_empty: true,
      hour: 6,
      minute: 30,
    } as Partial<DailyReservationEmailConfig> & { send_if_empty: boolean },
    fallback,
  );

  assert.deepEqual(config, {
    enabled: true,
    recipients: [
      {
        email: "one@example.com",
        enabled: true,
        send_if_empty: true,
      },
      {
        email: "two@example.com",
        enabled: true,
        send_if_empty: true,
      },
    ],
    hour: 6,
    minute: 30,
  });
});

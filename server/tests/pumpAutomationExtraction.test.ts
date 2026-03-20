import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractPumpReservationsFromSession } from "../src/services/pumpAutomationExtraction.ts";

const createSessionFixture = (responseBodies: unknown[]) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrats-pump-local-test-"));
  const responsesDir = path.join(storageDir, "responses");
  fs.mkdirSync(responsesDir, { recursive: true });

  const metadata = {
    sessionId: "test-session",
    timestamp: new Date().toISOString(),
    config: {},
    responses: [] as Array<Record<string, unknown>>,
    totalCaptured: responseBodies.length,
  };

  responseBodies.forEach((body, index) => {
    const filename = `${String(index).padStart(4, "0")}_response.json`;
    fs.writeFileSync(
      path.join(responsesDir, filename),
      JSON.stringify(
        {
          filename,
          url: "https://www.airbnb.fr/api/v3/multicalListingsAndCalendars/mock",
          method: "GET",
          status: 200,
          contentType: "application/json",
          body,
          timestamp: new Date().toISOString(),
          context: "test",
          keptByFilters: true,
          filterExplanation: "test",
        },
        null,
        2
      ),
      "utf-8"
    );

    metadata.responses.push({
      index,
      filename,
      url: "https://www.airbnb.fr/api/v3/multicalListingsAndCalendars/mock",
      method: "GET",
      status: 200,
      contentType: "application/json",
      context: "test",
      timestamp: new Date().toISOString(),
      hasBody: true,
      keptByFilters: true,
      filterExplanation: "test",
      searchText: "test",
    });
  });

  fs.writeFileSync(path.join(storageDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
  return storageDir;
};

const buildListingsAndCalendarsBody = (days: unknown[]) => ({
  data: {
    patek: {
      getMultiCalendarListingsAndCalendars: {
        multiCalendarListingsAttributes: {
          multiCalendarListings: [
            {
              listingId: "48504640",
              listingNameOrPlaceholderName: "Un ete au coeur de Broceliande",
              nickname: "Broc",
              listingThumbnailUrl: null,
            },
          ],
        },
        hostCalendarsResponse: {
          calendars: [
            {
              listingId: "48504640",
              days,
            },
          ],
        },
      },
    },
  },
});

test("ignore les jours notes encore disponibles dans l'extraction Pump locale", () => {
  const storageDir = createSessionFixture([
    buildListingsAndCalendarsBody([
      {
        day: "2026-03-19",
        listingId: "48504640",
        available: true,
        bookable: true,
        notes: "COLLE MOQUETTE DEFINITIF",
        unavailabilityReasons: null,
      },
    ]),
  ]);

  try {
    const extracted = extractPumpReservationsFromSession(storageDir);
    assert.equal(extracted.reservations.length, 0);
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

test("convertit les blocages host notes en reservations blocked locales", () => {
  const storageDir = createSessionFixture([
    buildListingsAndCalendarsBody([
      {
        day: "2026-03-27",
        listingId: "48504640",
        available: false,
        bookable: false,
        notes: "GdF - Veugeois",
        unavailabilityReasons: {
          reservation: null,
          hostBusy: true,
          busySubtype: "HOST_BUSY",
        },
      },
      {
        day: "2026-03-28",
        listingId: "48504640",
        available: false,
        bookable: false,
        notes: "GdF - Veugeois",
        unavailabilityReasons: {
          reservation: null,
          hostBusy: true,
          busySubtype: "HOST_BUSY",
        },
      },
    ]),
  ]);

  try {
    const extracted = extractPumpReservationsFromSession(storageDir);
    assert.equal(extracted.reservations.length, 1);
    assert.equal(extracted.reservations[0].type, "blocked");
    assert.equal(extracted.reservations[0].source, "calendar-note");
    assert.equal(extracted.reservations[0].listingId, "48504640");
    assert.equal(extracted.reservations[0].checkIn, "2026-03-27");
    assert.equal(extracted.reservations[0].checkOut, "2026-03-29");
    assert.equal(extracted.reservations[0].nights, 2);
    assert.equal(extracted.reservations[0].note, "GdF - Veugeois");
    assert.equal(extracted.reservations[0].status, "blocked");
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(root, "__month_timeline_browser.html");
const key = (year, month) => year * 12 + month - 1;
const november = key(2026, 11);
const gite = {
  id: "g1",
  nom: "Gîte de vérification",
  prefixe_contrat: "GT",
  ordre: 1,
  capacite_max: 4,
  nb_adultes_max: 4,
  nb_adultes_habituel: 2,
  prix_nuit_liste: [100],
};
const stay = {
  id: "winter-stay",
  gite_id: gite.id,
  gite,
  hote_nom: "Séjour de fin d’année",
  date_entree: "2026-12-30",
  date_sortie: "2027-01-03",
  nb_nuits: 4,
  nb_adultes: 2,
  nb_enfants_2_17: 0,
  prix_par_nuit: 100,
  prix_total: 400,
  remise_montant: 0,
  frais_optionnels_montant: 0,
  options: {},
};
let vite;
let browser;

const scroll = async (page, desktopCalendar, end) => {
  await page.evaluate(
    ({ desktopCalendar, end }) => {
      if (desktopCalendar) {
        const board = document.querySelector(".calendar-board__scroll");
        board.scrollTop = end ? board.scrollHeight : 0;
      } else {
        window.scrollTo({
          top: end ? document.documentElement.scrollHeight : 0,
          behavior: "instant",
        });
      }
    },
    { desktopCalendar, end },
  );
};

try {
  await writeFile(
    fixture,
    `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<body><div id="root"></div><script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Calendar from "/src/pages/CalendrierPage.tsx";
import Reservations from "/src/pages/ReservationsPage.tsx";
import "/src/styles.css";
const params = new URLSearchParams(location.search);
const calendar = params.get("view") === "calendar";
params.delete("view");
history.replaceState(null, "", (calendar ? "/calendrier" : "/reservations") + "?" + params);
createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter, null,
  React.createElement("div", {className: "app"},
    React.createElement("header", {className: "topbar", style: {height:"64px"}}, "Gestion"),
    React.createElement("main", {className: "content"},
      React.createElement(calendar ? Calendar : Reservations, {reportsEnabled: !calendar})))));
</script></body></html>`,
    { flag: "wx" },
  );
  vite = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true });

  for (const [view, width] of [
    ["calendar", 1440],
    ["calendar", 390],
    ["reservations", 1440],
    ["reservations", 390],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.clock.setFixedTime(new Date("2026-11-19T12:00:00Z"));
    page.setDefaultTimeout(10_000);
    const requests = [];
    let holdPrevious = null;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/reservations/calendar") {
        requests.push(Object.fromEntries(url.searchParams));
        if (holdPrevious) await holdPrevious;
        const first = key(
          Number(url.searchParams.get("year")),
          Number(url.searchParams.get("startMonth")),
        );
        const last = first + Number(url.searchParams.get("months")) - 1;
        return route.fulfill({
          json: {
            gites: [gite],
            reservations:
              first <= key(2027, 1) && last >= key(2026, 12) ? [stay] : [],
          },
        });
      }
      if (url.pathname === "/api/reservations") {
        requests.push(Object.fromEntries(url.searchParams));
        if (holdPrevious) await holdPrevious;
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        return route.fulfill({
          json: from < "2027-01-03" && to >= "2026-12-30" ? [stay] : [],
        });
      }
      if (url.pathname === "/api/reservations/winter-stay")
        return route.fulfill({ json: stay });
      if (url.pathname === "/api/gites") return route.fulfill({ json: [gite] });
      if (url.pathname === "/api/reservations/years")
        return route.fulfill({ json: [2026, 2027] });
      if (url.pathname === "/api/settings/source-colors")
        return route.fulfill({ json: { colors: {} } });
      if (url.pathname === "/api/reservations/live-energy")
        return route.fulfill({ json: {} });
      if (url.pathname === "/api/reports/reminders") {
        assert.equal(url.searchParams.get("year"), "2026");
        return route.fulfill({ json: { reminders: [], stale: true, calculatedAt: null } });
      }
      if (url.pathname === "/api/reports/night-summaries")
        return route.fulfill({ json: { properties: [], report: null } });
      return route.fulfill({ json: [] });
    });
    const start = vite.resolvedUrls.local[0] + path.basename(fixture);
    await page.goto(start + "?view=" + view);
    const isCalendar = view === "calendar";
    const desktopCalendar = isCalendar && width > 768;
    const initialMonths = isCalendar ? 7 : 4;
    const month = (index) => page.locator(`[data-timeline-month="${index}"]`);
    await month(november + 3).waitFor({ state: "attached" });
    await page
      .waitForFunction(
        ({ isCalendar, desktopCalendar, november }) => {
          if (isCalendar) {
            return (
              document.querySelector(".calendar-month-section--active")?.dataset
                .timelineMonth === String(november) &&
              (desktopCalendar
                ? document.querySelector(".calendar-board__scroll").scrollTop
                : window.scrollY) > 0
            );
          }
          const top =
            document
              .querySelector(".reservation-declarations")
              ?.getBoundingClientRect().top ?? 1000;
          const tabsBottom = document.querySelector(".reservations-tabs--sticky")
            ?.getBoundingClientRect().bottom ?? 1000;
          return window.scrollY > 0 && top >= tabsBottom && top < tabsBottom + 40;
        },
        { isCalendar, desktopCalendar, november },
      )
      .catch(async (failure) => {
        console.error(
          view,
          width,
          requests,
          errors,
          await page.evaluate(() => ({
            scroll: window.scrollY,
            sticky: [
              ...document.querySelectorAll(
                ".topbar,.calendar-hero,.calendar-weekdays,.reservations-tabs--sticky,.reservation-declarations",
              ),
            ].map((node) => ({
              className: node.className,
              top: node.getBoundingClientRect().top,
              height: node.getBoundingClientRect().height,
            })),
            months: [...document.querySelectorAll("[data-timeline-month]")].map(
              (node) => ({
                month: node.dataset.timelineMonth,
                top: node.getBoundingClientRect().top,
                active: node.classList.contains(
                  "calendar-month-section--active",
                ),
              }),
            ),
          })),
        );
        throw failure;
      });
    assert.equal(
      await page.locator("[data-timeline-month]").count(),
      initialMonths,
    );
    assert.deepEqual(requests, [
      isCalendar
        ? { year: "2026", startMonth: "8", months: "7" }
        : { from: "2026-11-01", to: "2027-02-28" },
    ]);
    const assertReminderMonth = async () => {
      assert.equal(await page.locator(".reservation-declarations").count(), 1);
      assert.equal(
        await month(november).evaluate((section) =>
          Boolean(section.previousElementSibling?.querySelector(".reservation-declarations")),
        ),
        true,
        "Le rappel reste juste au-dessus du mois civil en cours",
      );
    };
    if (!isCalendar) {
      await assertReminderMonth();
      assert.equal(
        await month(key(2026, 12))
          .getByText(stay.hote_nom, { exact: true })
          .count(),
        1,
      );
      assert.equal(
        await month(key(2027, 1))
          .getByText(stay.hote_nom, { exact: true })
          .count(),
        1,
      );
    }

    await scroll(page, desktopCalendar, true);
    await month(november + 6).waitFor({ state: "attached" });
    assert.deepEqual(
      requests[1],
      isCalendar
        ? { year: "2027", startMonth: "3", months: "3" }
        : { from: "2027-03-01", to: "2027-05-31" },
    );
    const first = isCalendar ? november - 3 : november;
    let releasePrevious;
    holdPrevious = new Promise((resolve) => {
      releasePrevious = resolve;
    });
    const waiting = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
        (isCalendar ? "/api/reservations/calendar" : "/api/reservations"),
    );
    await scroll(page, desktopCalendar, false);
    await waiting;
    const anchor = await month(first).evaluate(
      (section) => section.getBoundingClientRect().top,
    );
    releasePrevious();
    await month(first - 3).waitFor({ state: "attached" });
    assert.deepEqual(
      requests[2],
      isCalendar
        ? { year: "2026", startMonth: "5", months: "3" }
        : { from: "2026-08-01", to: "2026-10-31" },
    );
    assert.ok(
      Math.abs(
        (await month(first).evaluate(
          (section) => section.getBoundingClientRect().top,
        )) - anchor,
      ) < 3,
      "Le mois qui précédait le chargement reste à la même hauteur",
    );
    assert.equal(
      await page.locator("[data-timeline-month]").count(),
      initialMonths + 6,
    );
    if (!isCalendar) await assertReminderMonth();
    assert.deepEqual(errors, []);
    console.log(
      `${view} ${width}px · fenêtre initiale et pagination dans les deux sens vérifiées`,
    );

    if (!isCalendar && width === 1440) {
      await page.goto(
        start +
          "?view=reservations&focus=winter-stay&year=2026&month=0&tab=all-gites",
      );
      await page
        .locator(
          ".reservations-row--linked-focus[data-reservation-id='winter-stay']",
        )
        .first()
        .waitFor({ state: "visible" });
      assert.ok(await month(key(2026, 12)).isVisible());
      console.log("Lien direct vers un séjour de décembre vérifié");
      await page.goto(start + "?view=reservations&create=1&entry=2027-01-06&exit=2027-01-08&year=2027&month=1&tab=g1");
      const arrival = month(key(2027, 1)).locator('input[data-grid-col="1"][value="2027-01-06"]');
      await arrival.waitFor({ state: "visible" });
      assert.equal(await arrival.inputValue(), "2027-01-06");
      assert.equal(await page.locator(".reservation-declarations").count(), 0);
      console.log("Préremplissage depuis le calendrier en janvier vérifié");

    }
    await page.close();
  }
} finally {
  await browser?.close();
  await vite?.close();
  await unlink(fixture).catch(() => undefined);
}

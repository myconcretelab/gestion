import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const screenshots = await mkdtemp(path.join(tmpdir(), "payment-date-browser-"));
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
let tracking = {
  managed: true,
  total: 300,
  deposit: 0,
  received: 300,
  remaining: 0,
  overpaid: 0,
  requires_review: false,
  entries: [
    {
      id: "manual",
      amount: 100,
      method: "Espèces",
      purpose: "full",
      origin: "manual",
      paid_on: "2026-11-02T12:00:00.000Z",
      voided_at: null,
    },
    {
      id: "stripe",
      amount: 100,
      method: "Carte · Stripe",
      purpose: "full",
      origin: "stripe",
      paid_on: "2026-11-02T12:00:00.000Z",
      voided_at: null,
    },
    {
      id: "platform",
      amount: 100,
      method: "Versement plateforme",
      purpose: "full",
      origin: "platform",
      paid_on: "2026-11-02T12:00:00.000Z",
      paid_on_estimated: true,
      voided_at: null,
    },
  ],
};
let fail = true;
const writes = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: "fr-FR",
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/__payment-date-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment date verification</title></head><body><main class="today-reservation-drawer" style="max-width:480px;margin:auto;padding:16px"><div id="root"></div></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import Editor from '/src/pages/shared/ReservationPaymentsEditor.tsx';
    import {setCurrentAuthUser} from '/src/utils/auth.ts';
    import '/src/styles.css';
    setCurrentAuthUser(${JSON.stringify({ permissions: { isOwner: true, canWrite: true, canViewAmounts: true }, pageAccess: [] })});
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Editor,{reservation:{id:'test',booking_source:'Direct',options:{}},tracking:${JSON.stringify(tracking)}}));
    </script></body></html>`,
    }),
  );
  await page.route("**/api/**", async (route) => {
    assert.equal(route.request().method(), "PATCH");
    assert.ok(route.request().url().endsWith("/payments/manual/date"));
    const input = route.request().postDataJSON();
    writes.push(input);
    if (fail)
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "La date a changé. Actualisez les règlements.",
        }),
      });
    assert.equal(input.expected_paid_on, tracking.entries[0].paid_on);
    tracking.entries[0].paid_on = `${input.paid_on}T12:00:00.000Z`;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(tracking),
    });
  });
  await page.goto(`${origin}/__payment-date-test`);
  await page
    .getByRole("button", {
      name: /^Modifier la date (d’encaissement|du versement plateforme)/,
    })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: /^Modifier la date (d’encaissement|du versement plateforme)/,
      })
      .count(),
    2,
    "Stripe keeps its original receipt date",
  );
  await page
    .getByRole("button", {
      name: /^Modifier la date (d’encaissement|du versement plateforme)/,
    })
    .first()
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Modifier la date", exact: true })
      .count(),
    0,
  );
  const form = page.getByRole("form", {
    name: "Modifier la date du règlement",
  });
  await form.getByLabel("Date d’encaissement").fill("2026-09-15");
  await form.getByRole("button", { name: "Enregistrer la date" }).click();
  await page
    .getByRole("alert")
    .getByText(/La date a changé/)
    .waitFor();
  assert.equal(
    await form.getByLabel("Date d’encaissement").inputValue(),
    "2026-09-15",
  );
  fail = false;
  await form.getByRole("button", { name: "Enregistrer la date" }).click();
  await page.getByText(/15\/09\/2026/).waitFor();
  assert.equal(tracking.received, 300);
  assert.equal(tracking.entries.length, 3);
  assert.deepEqual(
    writes,
    Array(2).fill({
      paid_on: "2026-09-15",
      expected_paid_on: "2026-11-02T12:00:00.000Z",
    }),
  );
  await page.reload();
  await page.getByText(/15\/09\/2026/).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const inlineDate = page.getByRole("button", {
      name: /^Modifier la date du versement plateforme/,
    });
    assert.equal(await inlineDate.innerText(), "02/11/2026");
    assert.equal(
      await inlineDate.evaluate((button) => button.parentElement.tagName),
      "SMALL",
    );
    assert.equal(
      await inlineDate.evaluate((button) => getComputedStyle(button).boxShadow),
      "none",
    );
    await page.screenshot({
      path: path.join(screenshots, `payment-date-inline-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: /^Modifier la date (d’encaissement|du versement plateforme)/,
      })
      .first()
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "No horizontal overflow",
    );
    await page.screenshot({
      path: path.join(screenshots, `payment-date-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("form", { name: "Modifier la date du règlement" })
      .getByRole("button", { name: "Annuler", exact: true })
      .click();
  }
  assert.deepEqual(errors, []);
  console.log(
    `Payment date editor verified: correction, conflict, retry, preserved amounts, reload, Stripe protection, desktop and mobile. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
  await vite.close();
}

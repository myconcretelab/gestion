import crypto from "node:crypto";
import type { PlanningIntervention } from "@contrats/shared";
import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { syncActionTasks } from "./actionTasks.js";
import { syncCleaningTasks } from "./cleaningTasks.js";
import { readPlanningOrganization } from "./planningOrganizations.js";
import { buildPlanningRelayShortCode } from "./planningRelayShare.js";
import { toParisIsoDate, fullCleaningAmount } from "./userInterventions.js";

type Period = {
  id: string;
  label: string;
  date_debut: Date;
  date_fin: Date;
  gite_ids: unknown;
  organization_config: unknown;
  share_nonce: string;
  show_phones: boolean;
  show_comments: boolean;
  show_options: boolean;
  show_intervention_prices: boolean;
  arrivals_only: boolean;
  stay_nights: number | null;
};

export const planningAudienceSignature = (nonce: string, audience: string) =>
  crypto
    .createHmac("sha256", nonce)
    .update(`planning-audience:${audience}`)
    .digest("base64url");
export const planningAudienceIsValid = (
  nonce: string,
  audience: string,
  signature: unknown,
) => {
  if (typeof signature !== "string") return false;
  const expected = Buffer.from(planningAudienceSignature(nonce, audience));
  const actual = Buffer.from(signature);
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
};
export const planningPublicPath = (
  period: { share_nonce: string; organization_config?: unknown },
  workerId = "all",
) => {
  const path = `/r/${buildPlanningRelayShortCode(period.share_nonce)}`;
  const config = readPlanningOrganization(period.organization_config);
  return config?.audience === "individual"
    ? `${path}?audience=${encodeURIComponent(workerId)}&key=${planningAudienceSignature(period.share_nonce, workerId)}`
    : path;
};

export async function loadPlanningInterventions(
  period: Period,
  workerId?: string,
  includeAmounts = period.show_intervention_prices,
) {
  const from = period.date_debut.toISOString().slice(0, 10);
  const to = period.date_fin.toISOString().slice(0, 10);
  await syncActionTasks(from, to);
  await syncCleaningTasks(from, to);
  const ids = fromJsonString<string[]>(period.gite_ids, []);
  const config = readPlanningOrganization(period.organization_config);
  const [cleanings, actions, templates, gites, users] = await Promise.all([
    config?.missions.length &&
    !config.missions.some((mission) => mission.kind === "cleaning")
      ? []
      : prisma.cleaningTask.findMany({ where: { gite_id: { in: ids } } }),
    prisma.actionTask.findMany({
      where: {
        gite_id: { in: ids },
        starts_at: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${to}T23:59:59Z`),
        },
      },
    }),
    prisma.actionTemplate.findMany({
      where: { planning_period_id: period.id },
      select: { id: true },
    }),
    prisma.gite.findMany({ where: { id: { in: ids } } }),
    prisma.appUser.findMany({
      select: {
        id: true,
        display_name: true,
        intervenant_id: true,
        full_cleaning_rates: true,
      },
    }),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const giteMap = new Map(gites.map((gite) => [gite.id, gite]));
  const templateIds = new Set(templates.map((template) => template.id));
  const reservationIds = [
    ...new Set([
      ...cleanings.map((row) => row.departure_reservation_id),
      ...actions
        .map((row) => row.reservation_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];
  const reservations = await prisma.reservation.findMany({
    where: { id: { in: reservationIds } },
  });
  const reservationMap = new Map(reservations.map((row) => [row.id, row]));
  const rows: PlanningIntervention[] = [];
  const append = (
    task: (typeof actions)[number] | (typeof cleanings)[number],
    kind: "cleaning" | "task",
  ) => {
    const day = toParisIsoDate(task.starts_at);
    const user = userMap.get(task.assignee_id ?? "");
    const gite = giteMap.get(task.gite_id);
    const reservationId =
      "departure_reservation_id" in task
        ? task.departure_reservation_id
        : task.reservation_id;
    const reservation = reservationMap.get(reservationId ?? "");
    if (
      !gite ||
      day < from ||
      day > to ||
      (workerId && user?.intervenant_id !== workerId)
    )
      return;
    if (period.stay_nights && (reservation?.nb_nuits ?? 0) < period.stay_nights)
      return;
    if (
      kind === "task" &&
      config?.missions.length &&
      (!task ||
        !("template_id" in task) ||
        !templateIds.has(task.template_id ?? ""))
    )
      return;
    if (
      period.arrivals_only &&
      reservation &&
      toParisIsoDate(reservation.date_entree) !== day
    )
      return;
    const options = fromJsonString<
      Record<
        string,
        { enabled?: boolean; nb_lits?: number; nb_personnes?: number }
      >
    >(reservation?.options, {});
    const amount =
      kind === "cleaning" && "amount_snapshot" in task
        ? (task.amount_snapshot ??
          fullCleaningAmount(
            gite.options_menage_forfait,
            user?.full_cleaning_rates,
            task.gite_id,
          ))
        : "compensation_mode" in task && task.compensation_mode === "flat_rate"
          ? Number(task.compensation_amount)
          : null;
    rows.push({
      id: task.id,
      kind,
      date: day,
      title: "title" in task ? task.title : "Ménage",
      gite_id: gite.id,
      gite_name: gite.nom,
      assignee_id: task.assignee_id,
      assignee_name: user?.display_name ?? null,
      worker_id: user?.intervenant_id ?? null,
      starts_at: task.starts_at.toISOString(),
      due_at: task.due_at?.toISOString() ?? null,
      status: task.status,
      note: task.note,
      amount: includeAmounts ? amount : null,
      guest: reservation?.hote_nom ?? "",
      phone: period.show_phones ? (reservation?.telephone ?? null) : null,
      comment: period.show_comments ? (reservation?.commentaire ?? null) : null,
      options: period.show_options
        ? Object.entries(options)
            .filter(([, option]) => option?.enabled)
            .map(
              ([key, option]) =>
                `${key}${option.nb_lits ? ` · ${option.nb_lits} lits` : option.nb_personnes ? ` · ${option.nb_personnes} personnes` : ""}`,
            )
            .join(", ")
        : "",
      nights: reservation?.nb_nuits ?? 0,
      stay_from: reservation?.date_entree.toISOString().slice(0, 10),
      stay_to: reservation?.date_sortie.toISOString().slice(0, 10),
    });
  };
  cleanings.forEach((task) => append(task, "cleaning"));
  actions.forEach((task) => append(task, "task"));
  return rows.sort(
    (a, b) =>
      a.starts_at.localeCompare(b.starts_at) ||
      a.gite_name.localeCompare(b.gite_name, "fr") ||
      a.title.localeCompare(b.title, "fr"),
  );
}

export const escapePlanningHtml = (text: unknown) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function planningDocumentHtml(
  label: string,
  from: string,
  to: string,
  rows: PlanningIntervention[],
  publicUrl: string,
  showPrices: boolean,
  showTimeline = false,
) {
  const e = escapePlanningHtml;
  const euro = (value: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(value);
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR");
  const days: string[] = [];
  for (
    let value = Date.parse(from + "T12:00:00Z");
    value <= Date.parse(to + "T12:00:00Z");
    value += 86400000
  )
    days.push(new Date(value).toISOString().slice(0, 10));
  const giteNames = [...new Set(rows.map((row) => row.gite_name))];
  let timeline = "";
  if (showTimeline)
    for (let offset = 0; offset < days.length; offset += 14) {
      const slice = days.slice(offset, offset + 14);
      timeline += `<table class="timeline"><caption>Occupation et interventions · ${e(date(slice[0]))} au ${e(date(slice[slice.length - 1]))}</caption><thead><tr><th>Gîte</th>${slice.map((value) => `<th>${e(value.slice(8))}</th>`).join("")}</tr></thead><tbody>${giteNames
        .map(
          (gite) =>
            `<tr><th>${e(gite)}</th>${slice
              .map((value) => {
                const here = rows.filter(
                  (row) => row.gite_name === gite && row.date === value,
                );
                const occupied = rows.some(
                  (row) =>
                    row.gite_name === gite &&
                    row.stay_from &&
                    row.stay_to &&
                    row.stay_from <= value &&
                    row.stay_to > value,
                );
                return `<td class="${here.length ? "intervention" : occupied ? "occupied" : ""}">${here.length || (occupied ? "·" : "")}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
    }
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><style>
    body{font:12px Arial;color:#25332f;margin:0}h1{font-size:25px;margin-bottom:8px}p{line-height:1.6}table{width:100%;border-collapse:collapse;margin-top:24px}th{text-align:left;background:#f0f4f2}td,th{padding:10px 8px;border-bottom:1px solid #dce3df;vertical-align:top}small{display:block;margin-top:5px;color:#4c5c54}tr{break-inside:avoid}thead{display:table-header-group}.timeline{font-size:9px;margin:18px 0;break-inside:avoid}.timeline th,.timeline td{padding:6px 3px;text-align:center}.timeline th:first-child{text-align:left}.timeline caption{text-align:left;font-weight:bold;margin:8px 0}.occupied{background:#edf0ed}.intervention{background:#d7e2da;font-weight:bold}footer{margin-top:24px;font-size:10px;overflow-wrap:anywhere}.total{text-align:right;font-size:15px}a{color:inherit}
    </style><h1>${e(label)}</h1><p>Du ${e(date(from))} au ${e(date(to))} · ${rows.length} intervention(s)<br>Édité le ${e(new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}</p>
    ${timeline}<table><thead><tr><th>Date</th><th>Gîte et intervention</th><th>Intervenant et consignes</th>${showPrices ? "<th>Forfait</th>" : ""}</tr></thead><tbody>${rows.map((row) => `<tr><td>${e(date(row.date))}<small>${e(new Date(row.starts_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }))}${row.due_at ? ` → ${e(new Date(row.due_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}` : ""}</small></td><td><strong>${e(row.gite_name)}</strong><small>${e(row.title)}</small><small>${e(row.guest)}${row.nights ? ` · ${row.nights} nuits` : ""}</small><small>${e(row.options)}</small></td><td>${e(row.assignee_name ?? "À attribuer")}<small>${e(row.note)}</small><small>${e(row.comment)}</small><small>${e(row.phone)}</small></td>${showPrices ? `<td>${row.amount === null ? "—" : e(euro(row.amount))}</td>` : ""}</tr>`).join("")}</tbody></table>
    ${!rows.length ? "<p>Aucune intervention pour cette sélection.</p>" : ""}${showPrices ? `<p class="total">Total prévisionnel de la période : <strong>${e(euro(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)))}</strong></p>` : ""}<footer>Planning actualisé : <a href="${e(publicUrl)}">${e(publicUrl)}</a><br>Les montants prévus ne constituent pas un relevé de paiement.</footer></html>`;
}

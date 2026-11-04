import { randomUUID, createHash } from "node:crypto";
import {
  taxRemittanceAccounts,
  taxRemittanceSources,
  taxRemittanceSourcesOverlap,
  taxRemittanceTotals,
  type ReportCommand,
  type ReportProperty,
  type TaxRemittanceReceipt,
} from "@contrats/shared";
import { env } from "../../../config/env.js";
import { getOrganizationId } from "../../organizations/context.js";
import { LocalDocumentStorage } from "../../documents/storage.js";
import type { ReportConfiguration } from "./configuration.js";

export type RemittanceCommand = Extract<
  ReportCommand,
  { type: `remittance-${string}` }
>;
const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status, statusCode: status });
const storage = () => new LocalDocumentStorage(env.DATA_DIR, env.DATA_DIR);
const storageKey = (receipt: TaxRemittanceReceipt) =>
  `uploads/tourist-tax-remittances/${receipt.id}`;
export async function removeUncommittedReceipt(receipt: TaxRemittanceReceipt) {
  await storage().delete(getOrganizationId(), storageKey(receipt));
}
export async function readRemittanceReceipt(receipt: TaxRemittanceReceipt) {
  const content = await storage().read(
    getOrganizationId(),
    storageKey(receipt),
  );
  if (
    createHash("sha256").update(content).digest("hex") !==
    receipt.checksumSha256
  )
    throw fail("Le justificatif conservé est endommagé.", 409);
  return content;
}

/** Mutates only the tenant's report configuration, inside its revision-checked transaction. */
export async function applyRemittanceCommand(
  config: ReportConfiguration,
  properties: ReportProperty[],
  managers: Array<{ id: string; name: string }>,
  command: RemittanceCommand,
  userId?: string,
): Promise<TaxRemittanceReceipt | undefined> {
  const accounts = taxRemittanceAccounts({ ...config, properties, managers });
  const remittances = config.taxRemittances ?? [];
  const now = new Date().toISOString();
  if (command.type === "remittance-save") {
    const input = command.remittance;
    const account = accounts.find((a) => a.id === input.accountId);
    if (!account) throw fail("Propriétaire introuvable.", 404);
    const previous = remittances.find((r) => r.id === input.id);
    if (!previous && !account.propertyIds.length)
      throw fail("Ce propriétaire ne suit plus de gîte.");
    if (previous?.cancelledAt) throw fail("Ce reversement est annulé.");
    if (
      previous &&
      (previous.accountId !== account.id ||
        JSON.stringify(previous.sources.map((s) => s.key).sort()) !==
          JSON.stringify([...input.sourceKeys].sort()))
    )
      throw fail(
        "Le propriétaire et les déclarations d’un reversement enregistré sont conservés.",
      );
    const available = taxRemittanceSources(config, account);
    const sources =
      previous?.sources ??
      input.sourceKeys.map((key) => {
        const source = available.find((s) => s.key === key);
        if (!source)
          throw fail(
            "Une déclaration sélectionnée n’est pas confirmée ou son registre est incomplet.",
          );
        return source;
      });
    if (!previous) {
      if (remittances.length >= 2000)
        throw fail("La limite de 2 000 reversements est atteinte.");
      const alreadyUsed = remittances
        .filter((r) => !r.cancelledAt)
        .flatMap((r) => r.sources);
      if (
        sources.some((source, index) =>
          [...sources.slice(0, index), ...alreadyUsed].some((other) =>
            taxRemittanceSourcesOverlap(source, other),
          ),
        )
      )
        throw fail(
          "Un gîte sur une même période figure déjà dans un reversement ou dans deux déclarations sélectionnées.",
        );
    }
    const total = taxRemittanceTotals({
      sources,
      payments: [],
      declaredAmountCents: input.declaredAmountCents,
    });
    if (
      (total.differenceCents ||
        (previous &&
          previous.declaredAmountCents !== input.declaredAmountCents)) &&
      input.note.length < 3
    )
      throw fail(
        "Expliquez l’écart ou la correction du montant déclaré dans la note.",
      );
    const { sourceKeys: _keys, ...values } = input;
    const saved = {
      ...previous,
      ...values,
      accountName: previous?.accountName ?? account.name,
      sources,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      payments: previous?.payments ?? [],
    };
    config.taxRemittances = previous
      ? remittances.map((r) => (r.id === saved.id ? saved : r))
      : [...remittances, saved];
    return;
  }
  const remittance = remittances.find((r) => r.id === command.remittanceId);
  if (!remittance) throw fail("Reversement introuvable.", 404);
  if (remittance.cancelledAt) throw fail("Ce reversement est annulé.");
  if (command.type === "remittance-payment") {
    if (remittance.payments.some((p) => p.id === command.payment.id))
      throw fail("Ce paiement est déjà enregistré.", 409);
    if (remittance.payments.length >= 200)
      throw fail("La limite de 200 paiements est atteinte.");
    remittance.payments.push({
      ...command.payment,
      recordedAt: now,
      recordedBy: userId ?? null,
    });
  } else if (command.type === "remittance-cancel") {
    if (taxRemittanceTotals(remittance).paidCents)
      throw fail(
        "Annulez d’abord les paiements saisis par erreur avant d’annuler ce reversement.",
      );
    remittance.cancelledAt = now;
    remittance.cancelReason = command.reason;
  } else {
    const payment = remittance.payments.find((p) => p.id === command.paymentId);
    if (!payment) throw fail("Paiement introuvable.", 404);
    if (payment.voidedAt) throw fail("Ce paiement est déjà annulé.");
    if (command.type === "remittance-void-payment") {
      payment.voidedAt = now;
      payment.voidReason = command.reason;
    } else {
      if ((payment.receipts?.length ?? 0) >= 10)
        throw fail("La limite de 10 justificatifs par paiement est atteinte.");
      const content = Buffer.from(command.file.data, "base64");
      if (
        !content.length ||
        content.length > 5_000_000 ||
        content.toString("base64") !== command.file.data
      )
        throw fail(
          "Le justificatif doit être un fichier PDF, PNG ou JPEG de 5 Mo maximum.",
        );
      const contentType =
        content.subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : content
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : content.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
              ? "image/jpeg"
              : null;
      if (!contentType)
        throw fail(
          "Format de justificatif non accepté. Choisissez un PDF, PNG ou JPEG.",
        );
      const receipt: TaxRemittanceReceipt = {
        id: randomUUID(),
        name:
          command.file.name
            .split(/[\\/]/)
            .pop()!
            .replace(/[\x00-\x1f\x7f]/g, "")
            .trim() || "Justificatif",
        contentType,
        sizeBytes: content.length,
        checksumSha256: createHash("sha256").update(content).digest("hex"),
        uploadedAt: now,
      };
      await storage().put(getOrganizationId(), storageKey(receipt), content);
      payment.receipts = [...(payment.receipts ?? []), receipt];
      remittance.updatedAt = now;
      return receipt;
    }
  }
  remittance.updatedAt = now;
}

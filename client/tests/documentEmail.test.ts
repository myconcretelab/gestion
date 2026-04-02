import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentEmailDraft, buildDocumentMailtoHref, renderEmailBodyHtml } from "../src/utils/documentEmail.ts";

const extractMailtoParts = (href: string) => {
  const [rawRecipient, rawQuery = ""] = href.replace(/^mailto:/, "").split("?");
  const params = new URLSearchParams(rawQuery);
  return {
    recipient: decodeURIComponent(rawRecipient),
    subject: params.get("subject") ?? "",
    body: params.get("body") ?? "",
  };
};

test("buildDocumentMailtoHref rend le texte detaille du contrat depuis le template JSON", () => {
  const href = buildDocumentMailtoHref({
    recipient: "mickael@example.com",
    documentType: "contrat",
    documentNumber: "LIB-2026-000123",
    documentUrl: "https://example.com/contracts/LIB-2026-000123.pdf",
    locataireNom: "Mickael",
    giteNom: "Liberté",
    dateDebut: "2026-06-05",
    heureArrivee: "17:00",
    dateFin: "2026-06-07",
    heureDepart: "17:00",
    nbNuits: 2,
    arrhesMontant: 170,
    arrhesDateLimite: "2026-01-30",
    soldeMontant: 800,
  });

  assert.ok(href);
  const mail = extractMailtoParts(href);

  assert.equal(mail.recipient, "mickael@example.com");
  assert.equal(mail.subject, "Contrat Liberté LIB-2026-000123");
  assert.match(mail.body, /Bonjour Mickael,/);
  assert.match(mail.body, /séjour de 2 nuits au Liberté/);
  assert.match(mail.body, /vendredi 5 juin 2026, à partir de 17h au dimanche 7 juin 2026, 17h/);
  assert.match(mail.body, /arrhes de 170€/);
  assert.match(mail.body, /avant le vendredi 30 janvier 2026/);
  assert.match(mail.body, /soit 800€/);
  assert.match(mail.body, /Lien de téléchargement du contrat :/);
  assert.match(mail.body, /https:\/\/example.com\/contracts\/LIB-2026-000123\.pdf/);
  assert.match(mail.body, /Les calèches de Brocéliande/);
  assert.match(mail.body, /https:\/\/destination-broceliande\.com\//);
});

test("buildDocumentMailtoHref conserve le template simple pour les factures", () => {
  const href = buildDocumentMailtoHref({
    recipient: "client@example.com",
    documentType: "facture",
    documentNumber: "FAC-2026-000001",
    documentUrl: "https://example.com/invoices/FAC-2026-000001.pdf",
    locataireNom: "Client",
    giteNom: "Liberté",
  });

  assert.ok(href);
  const mail = extractMailtoParts(href);

  assert.equal(mail.subject, "Facture Liberté FAC-2026-000001");
  assert.match(mail.body, /Bonjour Client,/);
  assert.match(mail.body, /Je vous joins un lien de téléchargement vers votre facture\./);
  assert.match(mail.body, /agréable séjour au Liberté\./);
});

test("buildDocumentEmailDraft expose le sujet et le corps editables", () => {
  const draft = buildDocumentEmailDraft({
    recipient: "client@example.com",
    documentType: "contrat",
    documentNumber: "LIB-2026-000123",
    documentUrl: "https://example.com/contracts/LIB-2026-000123.pdf",
    locataireNom: "Mickael",
    giteNom: "Liberté",
    dateDebut: "2026-06-05",
    heureArrivee: "17:00",
    dateFin: "2026-06-07",
    heureDepart: "17:00",
    nbNuits: 2,
    arrhesMontant: 170,
    arrhesDateLimite: "2026-01-30",
    soldeMontant: 800,
  });

  assert.equal(draft.recipient, "client@example.com");
  assert.equal(draft.subject, "Contrat Liberté LIB-2026-000123");
  assert.match(draft.body, /Lien de téléchargement du contrat :/);
  assert.match(draft.body, /Les calèches de Brocéliande/);
});

test("renderEmailBodyHtml convertit les paragraphes et liens en aperçu HTML", () => {
  const html = renderEmailBodyHtml("Bonjour,\n\nLien utile :\nhttps://example.com/doc.pdf");

  assert.match(html, /<p>Bonjour,<\/p>/);
  assert.match(html, /Lien utile :<br \/>/);
  assert.match(html, /<a href="https:\/\/example.com\/doc\.pdf"/);
});

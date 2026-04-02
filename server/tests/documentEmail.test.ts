import assert from "node:assert/strict";
import test from "node:test";
import { buildContractEmailMessage, buildInvoiceEmailMessage } from "../src/services/documentEmail.ts";

test("buildContractEmailMessage construit un email de contrat exploitable", () => {
  const message = buildContractEmailMessage(
    {
      numero_contrat: "GT-2026-000001",
      locataire_nom: "Mickael",
      locataire_email: "mickael@example.com",
      gite: { nom: "Liberté", email: "gite@example.com" },
      date_debut: "2026-06-05",
      heure_arrivee: "17:00",
      date_fin: "2026-06-07",
      heure_depart: "10:00",
      nb_nuits: 2,
      arrhes_montant: 170,
      arrhes_date_limite: "2026-01-30",
      solde_montant: 800,
    },
    {
      documentUrl: "https://example.com/contracts/GT-2026-000001.pdf",
    }
  );

  assert.equal(message.subject, "Contrat Liberté GT-2026-000001");
  assert.match(message.text, /Bonjour Mickael,/);
  assert.match(message.text, /Suite à votre appel/);
  assert.match(message.text, /2 nuits au Liberté/);
  assert.match(message.text, /vendredi 5 juin 2026/);
  assert.match(message.text, /arrhes de 170€/);
  assert.match(message.text, /soit 800€/);
  assert.match(message.text, /https:\/\/example.com\/contracts\/GT-2026-000001\.pdf/);
  assert.match(message.text, /Les calèches de Brocéliande/);
  assert.match(message.html, /<p>Bonjour Mickael,/);
});

test("buildInvoiceEmailMessage construit un email de facture exploitable", () => {
  const message = buildInvoiceEmailMessage(
    {
      numero_facture: "GT-2026-01",
      locataire_nom: "Client",
      locataire_email: "client@example.com",
      gite: { nom: "Liberté" },
    },
    {
      documentUrl: "https://example.com/invoices/GT-2026-01.pdf",
    }
  );

  assert.equal(message.subject, "Facture Liberté GT-2026-01");
  assert.match(message.text, /lien de téléchargement vers votre facture/);
  assert.match(message.text, /agréable séjour au Liberté/);
  assert.match(message.text, /https:\/\/example.com\/invoices\/GT-2026-01\.pdf/);
  assert.match(message.html, /Facture Liberté GT-2026-01|agréable séjour au Liberté/);
});

test("buildContractEmailMessage accepte un sujet et un corps personnalises", () => {
  const message = buildContractEmailMessage(
    {
      numero_contrat: "GT-2026-000001",
      locataire_nom: "Mickael",
      locataire_email: "mickael@example.com",
      gite: { nom: "Liberté", email: "gite@example.com" },
      date_debut: "2026-06-05",
      heure_arrivee: "17:00",
      date_fin: "2026-06-07",
      heure_depart: "10:00",
      nb_nuits: 2,
      arrhes_montant: 170,
      arrhes_date_limite: "2026-01-30",
      solde_montant: 800,
    },
    {
      customMessage: {
        subject: "Sujet personnalisé",
        body: "Bonjour,\n\nTexte modifié.",
      },
    }
  );

  assert.equal(message.subject, "Sujet personnalisé");
  assert.equal(message.text, "Bonjour,\n\nTexte modifié.");
  assert.match(message.html, /Texte modifié/);
});

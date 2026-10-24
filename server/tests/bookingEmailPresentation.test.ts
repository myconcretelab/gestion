import "./helpers/emailTestData.js";
import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingEmailMessage } from "../src/services/bookingRequestEmail.js";
import {
  buildDefaultDocumentEmailTemplateSettings,
  writeDocumentEmailTemplateSettings,
  readDocumentEmailTemplateSettings,
  mergeDocumentEmailTemplateSettings,
  buildDocumentEmailTextSettingsResponse,
} from "../src/services/documentEmailTemplateSettings.js";
import {
  emailHttpUrl,
  renderEmailPresentation,
} from "../src/services/emailPresentation.js";

const payload = {
  id: "fictitious-request",
  hote_nom: "Camille <Test>",
  email: "client@example.test",
  telephone: "0600000000",
  message_client: "Besoin d’un lit bébé",
  date_entree: "2027-02-10",
  date_sortie: "2027-02-14",
  nb_adultes: 2,
  nb_enfants_2_17: 1,
  hold_expires_at: "2027-02-01T00:00:00Z",
  gite: { nom: "Gîte & jardin" },
  options: { chiens: { enabled: true, nb: 1 } },
  pricing_snapshot: {
    nb_nuits: 4,
    montant_hebergement: 300,
    total_options: 60,
    taxe_sejour: 0,
    total_global: 360,
    arrhes_theoriques: 90,
    options_detail: { chiens: 60 },
    options_unit_prices: { chiens: 15 },
  },
} as any;
const branding = {
  name: "Marque du gîte",
  color: "#315f4b",
  logoUrl: "https://example.test/logo.png",
  photoUrl: "https://example.test/gite.jpg",
};
test.beforeEach(() =>
  writeDocumentEmailTemplateSettings(
    buildDefaultDocumentEmailTemplateSettings(),
  ),
);

test("l’approbation manuelle et la confirmation carte reprennent les textes configurés, le logo et la photo", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.subject =
    "Bienvenue {{clientName}} · {{giteName}}";
  settings.bookingRequestApproved.bodyLines = [
    "{{greeting}}",
    "",
    "Notre accueil personnalisé.",
    "",
    "{{optionsSummary}}",
    "",
    "{{paymentSummary}}",
  ];
  writeDocumentEmailTemplateSettings(settings);
  for (const payment of [
    undefined,
    {
      purpose: "deposit",
      total_cents: 36000,
      paid_amount_cents: 9000,
      refunded_amount_cents: 0,
      status: "paid",
    },
  ]) {
    const message = buildBookingEmailMessage(
      "bookingRequestApproved",
      payload,
      { branding, payment },
    );
    assert.equal(message.subject, "Bienvenue Camille <Test> · Gîte & jardin");
    assert.match(message.text, /Notre accueil personnalisé/);
    assert.match(message.text, /Chiens : 15.*× 4 nuits = 60/);
    assert.match(message.html, /src="https:\/\/example.test\/logo.png"/);
    assert.match(message.html, /src="https:\/\/example.test\/gite.jpg"/);
    assert.match(message.html, /Camille &lt;Test&gt;/);
    assert.doesNotMatch(message.text, /{{/);
    if (payment) {
      assert.match(message.text, /90,00/);
      assert.match(message.text, /270,00/);
    } else assert.doesNotMatch(message.text, /reçues par Stripe/);
  }
});
test("un ancien texte « total à régler sur place » s’adapte au solde réellement dû", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.bodyLines = [
    "Total {{totalGlobal}} à régler sur place.",
  ];
  writeDocumentEmailTemplateSettings(settings);
  const loaded = readDocumentEmailTemplateSettings();
  assert.match(
    loaded.bookingRequestApproved.bodyLines[0],
    /stayPaymentInstruction/,
  );
  const payment = {
    purpose: "full",
    total_cents: 36000,
    paid_amount_cents: 36000,
    refunded_amount_cents: 0,
    status: "paid",
  };
  const full = buildBookingEmailMessage("bookingRequestApproved", payload, {
    payment,
  });
  assert.doesNotMatch(full.text, /360,00.*à régler sur place/);
  assert.match(full.text, /déjà réglé en totalité/);
  const partial = buildBookingEmailMessage("bookingRequestApproved", payload, {
    payment: { ...payment, purpose: "deposit", paid_amount_cents: 9000 },
  });
  assert.match(
    partial.text,
    /Vous avez déjà réglé 90,00\s*€ d’arrhes\. Le solde à régler sur place est de 270,00\s*€/,
  );
  assert.match(partial.html, /Vous avez déjà réglé 90,00/);
});
test("accusé de réception et refus conservent leur statut ; les coordonnées client restent dans la notification propriétaire", () => {
  const received = buildBookingEmailMessage("bookingRequestReceived", payload, {
    branding,
  });
  assert.match(received.text, /demande.*bien été reçue/);
  assert.doesNotMatch(
    received.text,
    /séjour.*accepté|réservation.*confirmée|0600000000|lit bébé/,
  );
  const owner = buildBookingEmailMessage("bookingRequestOwner", payload, {
    branding,
  });
  assert.match(owner.text, /0600000000/);
  assert.match(owner.text, /lit bébé/);
  const rejected = buildBookingEmailMessage("bookingRequestRejected", payload, {
    decisionNote: "Dates indisponibles",
  });
  assert.match(rejected.text, /Dates indisponibles/);
  assert.doesNotMatch(rejected.text, /temporairement.*bloquées/);
});
test("les modèles ajoutés se personnalisent sans remplacer les textes déjà enregistrés", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.bodyLines = [
    "Notre texte existant",
    "{{optionsSummary}}",
  ];
  const merged = mergeDocumentEmailTemplateSettings(settings, {
    bookingRequestReceived: {
      subject: "Merci {{clientName}}",
      body: "Notre accusé {{giteName}}",
    },
    bookingRequestApprovedOwner: {
      subject: "Nouvelle réservation de {{clientName}}",
      body: "Notre notification propriétaire.\n{{clientDetails}}\n{{paymentSummary}}",
    },
  });
  assert.deepEqual(
    merged.bookingRequestApproved.bodyLines,
    settings.bookingRequestApproved.bodyLines,
  );
  const response = buildDocumentEmailTextSettingsResponse(merged);
  assert.equal(
    response.bookingRequestReceived.body,
    "Notre accusé {{giteName}}",
  );
  assert.equal(
    response.bookingRequestApprovedOwner.subject,
    "Nouvelle réservation de {{clientName}}",
  );
  writeDocumentEmailTemplateSettings(merged);
  const owner = buildBookingEmailMessage("bookingRequestApproved", payload, {
    audience: "owner",
  });
  assert.match(owner.text, /Notre notification propriétaire/);
  assert.equal(owner.subject, "Nouvelle réservation de Camille <Test>");
});
test("les paiements à vérifier ne sont pas présentés comme une réservation confirmée", () => {
  const payment = {
    purpose: "deposit",
    total_cents: 36000,
    paid_amount_cents: 100,
    refunded_amount_cents: 0,
    status: "requires_review",
  };
  const message = buildBookingEmailMessage("bookingPaymentReview", payload, {
    payment,
  });
  assert.match(message.text, /Aucun nouveau paiement/);
  assert.doesNotMatch(message.text, /réservation.*confirmée|Solde.*359/);
});
test("la notification propriétaire ouvre la demande, sans lien interne dans l’accusé client", () => {
  const owner = buildBookingEmailMessage("bookingRequestOwner", payload, {
    branding,
  });
  const actionUrl = owner.text.split("\n").at(-1)!;
  assert.equal(
    new URL(actionUrl).pathname.endsWith("/demandes/fictitious-request"),
    true,
  );
  assert.ok(owner.html.includes('href="' + actionUrl + '"'));
  assert.match(owner.html, />Voir la demande<\/a>/);
  const guest = buildBookingEmailMessage("bookingRequestReceived", payload, {
    branding,
  });
  assert.doesNotMatch(guest.text + guest.html, /Voir la demande|\/demandes\//);
});
test("les copies propriétaire après arrhes ou totalité ciblent la réservation, son gîte et sa période", () => {
  const confirmed = {
    ...payload,
    approved_reservation_id: "reservation-123",
    gite: { ...payload.gite, id: "gite-1" },
  };
  for (const purpose of ["deposit", "full"]) {
    const payment = {
      purpose,
      total_cents: 36000,
      paid_amount_cents: purpose === "deposit" ? 9000 : 36000,
      refunded_amount_cents: 0,
      status: "paid",
    };
    const owner = buildBookingEmailMessage(
      "bookingRequestApproved",
      confirmed,
      { branding, payment, audience: "owner" },
    );
    const target = new URL(owner.text.split("\n").at(-1)!);
    assert.equal(target.pathname.endsWith("/reservations"), true);
    assert.equal(target.searchParams.get("year"), "2027");
    assert.equal(target.searchParams.get("month"), "2");
    assert.equal(target.searchParams.get("tab"), "gite-1");
    assert.equal(target.searchParams.get("focus"), "reservation-123");
    assert.match(owner.html, />Voir la réservation<\/a>/);
    assert.equal(
      owner.subject,
      "Réservation confirmée · Camille <Test> · Gîte & jardin",
    );
    assert.match(owner.text, /Une réservation a été confirmée automatiquement/);
    assert.match(owner.text, /Client : Camille <Test>/);
    assert.match(owner.text, /0600000000/);
    assert.match(owner.text, /Aucune approbation manuelle/);
    assert.doesNotMatch(
      owner.text,
      /Bonjour Camille|votre séjour|votre demande|idées d’activités/i,
    );
    assert.match(owner.html, /Règlement du client/);
    assert.doesNotMatch(target.href, /token|secret/);
    const guest = buildBookingEmailMessage(
      "bookingRequestApproved",
      confirmed,
      { branding, payment },
    );
    assert.match(guest.text, /Bonjour Camille/);
    assert.doesNotMatch(
      guest.text,
      /Une réservation a été confirmée automatiquement|Client : Camille/,
    );
    assert.doesNotMatch(
      guest.text + guest.html,
      /\/reservations\?|Voir la réservation|reservation-123/,
    );
    const receipt = buildBookingEmailMessage(
      "bookingPaymentReceipt",
      { ...payload, id: "existing-reservation" },
      {
        branding,
        payment,
        audience: "owner",
        reservationId: "existing-reservation",
      },
    );
    assert.equal(
      new URL(receipt.text.split("\n").at(-1)!).searchParams.get("focus"),
      "existing-reservation",
    );
  }
});
test("reçus, paiements à vérifier et remboursements ont aussi des textes dédiés au propriétaire", () => {
  for (const [type, status, refunded, expected] of [
    [
      "bookingPaymentReceipt",
      "paid",
      0,
      /Un paiement en ligne a été enregistré/,
    ],
    ["bookingPaymentReview", "requires_review", 0, /Contrôler le dossier/],
    [
      "bookingPaymentRefunded",
      "refunded",
      9000,
      /Un remboursement a été enregistré/,
    ],
  ] as const) {
    const payment = {
      purpose: "deposit",
      total_cents: 36000,
      paid_amount_cents: 9000,
      refunded_amount_cents: refunded,
      status,
    };
    const owner = buildBookingEmailMessage(type, payload, {
      audience: "owner",
      payment,
    });
    assert.match(owner.text, expected);
    assert.match(owner.text, /Client : Camille/);
    assert.doesNotMatch(
      owner.text + owner.subject,
      /Bonjour Camille|votre séjour|votre paiement|nous vous contacterons/i,
    );
    const guest = buildBookingEmailMessage(type, payload, { payment });
    assert.match(guest.text, /Bonjour Camille/);
    assert.doesNotMatch(
      guest.text + guest.html,
      /Client : Camille|Voir la demande|Voir la réservation/,
    );
  }
});
test("la présentation échappe le contenu et ignore les adresses d’images non HTTP", () => {
  const html = renderEmailPresentation({
    subject: "<script>alert(1)</script>",
    text: '<img src=x onerror="bad">\nhttps://example.test/a?x=1&y=2',
    branding: {
      name: "<Gîte>",
      logoUrl: "javascript:bad",
      photoUrl: "file:///secret",
    },
    action: { label: "Lien invalide", url: "javascript:bad" },
  });
  assert.doesNotMatch(
    html,
    /<script>|src="javascript|src="file:|href="javascript/,
  );
  assert.match(html, /&lt;img/);
  assert.equal(emailHttpUrl("https://user:secret@example.test/image"), "");
  assert.equal(
    emailHttpUrl("/logo.png", "https://example.test"),
    "https://example.test/logo.png",
  );
});

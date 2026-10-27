import "./helpers/emailTestData.js";
import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { resolveEmailPresentation } from "../src/services/emailBranding.js";
import { buildBookingEmailMessage } from "../src/services/bookingRequestEmail.js";
import { getOrganizationId } from "../src/services/organizationContext.js";

test("les mails client et propriétaire utilisent la route publique des photos téléchargées", async () => {
  const originalGite = prisma.gite.findUnique;
  const originalSettings = prisma.organizationSettings.findUnique;
  const originalBase = env.APP_PUBLIC_URL;
  let photoSelection: any;
  try {
    env.APP_PUBLIC_URL = "https://gestion.example.test";
    prisma.organizationSettings.findUnique = (async () => ({
      setup_completed: true,
      profile_json: JSON.stringify({
        publicDisplayName: "Les gîtes",
        logoUrl: "/logo.png",
      }),
    })) as any;
    let photoUrl =
      "/api/gites/gite-test/photos/photo-test/file/data%2Fphoto.jpg";
    prisma.gite.findUnique = (async (args: any) => {
      photoSelection = args.select.photos;
      return {
        id: "gite-test",
        nom: "Le gîte",
        photos: [{ id: "photo-test", url: photoUrl, alt: "Le jardin" }],
      };
    }) as any;

    const { branding } = await resolveEmailPresentation({ id: "gite-test" });
    assert.equal(
      branding.photoUrl,
      "https://gestion.example.test/api/public/gites/photos/photo-test",
    );
    assert.equal(branding.logoUrl, "https://gestion.example.test/logo.png");
    assert.deepEqual(photoSelection.where, {
      is_public: true,
      organization_id: getOrganizationId(),
    });
    assert.equal(photoSelection.select.id, true);
    const payload: any = {
      id: "request-test",
      hote_nom: "Client fictif",
      email: "client@example.test",
      date_entree: "2027-03-09",
      date_sortie: "2027-03-12",
      hold_expires_at: "2027-03-01",
      nb_adultes: 2,
      nb_enfants_2_17: 0,
      gite: { nom: "Le gîte" },
      pricing_snapshot: {
        nb_nuits: 3,
        montant_hebergement: 150,
        total_options: 0,
        total_global: 150,
        arrhes_theoriques: 30,
      },
    };
    for (const type of [
      "bookingRequestOwner",
      "bookingRequestReceived",
      "bookingRequestApproved",
      "bookingRequestApprovedOwner",
    ] as const) {
      const message = buildBookingEmailMessage(type, payload, { branding });
      assert.ok(
        message.html.includes(
          'src="https://gestion.example.test/api/public/gites/photos/photo-test"',
        ),
        type,
      );
      assert.doesNotMatch(message.html, /\/api\/gites\//);
    }

    photoUrl = "https://photos.example.test/jardin.jpg";
    const external = await resolveEmailPresentation({ id: "gite-test" });
    assert.equal(external.branding.photoUrl, photoUrl);

    prisma.gite.findUnique = (async () => ({
      id: "gite-test",
      nom: "Le gîte",
      photos: [],
    })) as any;
    const withoutPhoto = await resolveEmailPresentation({ id: "gite-test" });
    assert.equal(withoutPhoto.branding.photoUrl, "");
    assert.doesNotMatch(
      buildBookingEmailMessage("bookingRequestApproved", payload, withoutPhoto)
        .html,
      /class="hero"/,
    );
  } finally {
    prisma.gite.findUnique = originalGite;
    prisma.organizationSettings.findUnique = originalSettings;
    env.APP_PUBLIC_URL = originalBase;
  }
});

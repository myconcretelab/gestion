import { Router, urlencoded, type Request, type Response } from "express";
import { z } from "zod";
import { bookingStripeConfig } from "./provider.js";
import { runWithOrganization } from "../organizations/context.js";
import {
  createReservationPaymentLink,
  loadPaymentLink,
  paymentLinkChoices,
  paymentLinkUrl,
  revokeReservationPaymentLink,
  startReservationLinkCheckout,
} from "./reservationLinks.js";
import { refreshPayment } from "./service.js";
import {
  enforceRequestRateLimit,
  PUBLIC_API_THROTTLE_CONFIG,
  sendThrottleResponse,
} from "../../services/requestThrottle.js";

export const reservationPaymentLinksRouter = Router();
reservationPaymentLinksRouter.get(
  "/:id/payment-links",
  async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await paymentLinkChoices(req.params.id));
    } catch (error) {
      next(error);
    }
  },
);
reservationPaymentLinksRouter.post(
  "/:id/payment-links",
  async (req, res, next) => {
    try {
      const { purpose } = z
        .object({ purpose: z.enum(["deposit", "balance"]) })
        .parse(req.body);
      res
        .status(201)
        .json(await createReservationPaymentLink(req.params.id, purpose));
    } catch (error) {
      next(error);
    }
  },
);
reservationPaymentLinksRouter.post(
  "/:id/payment-links/:linkId/revoke",
  async (req, res, next) => {
    try {
      await revokeReservationPaymentLink(req.params.id, req.params.linkId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const html = (title: string, content: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)}</title><style>body{margin:0;background:#f5f5f0;color:#24302c;font:17px/1.6 system-ui,sans-serif}main{max-width:510px;margin:7vh auto;padding:28px;background:#fff;border:1px solid #ddd;border-radius:18px;box-shadow:0 10px 40px #2030200b}h1{font-size:28px;line-height:1.2}h2{font-size:21px}.amount{font-size:36px;font-weight:700;margin:24px 0}.test{background:#fff3d8;padding:10px;border-radius:8px;font-size:14px}button,.button{display:block;width:100%;box-sizing:border-box;background:#526344;color:white;border:0;border-radius:10px;padding:15px;text-align:center;text-decoration:none;font:600 17px system-ui;cursor:pointer}small{display:block;color:#666;margin-top:16px}p{overflow-wrap:anywhere}@media(max-width:570px){main{margin:18px;padding:22px}}</style></head><body><main><p class="test">Mode test Stripe — aucun paiement réel</p><h1>${escape(title)}</h1>${content}</main></body></html>`;
const withPublicLink =
  (work: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    const throttle = await enforceRequestRateLimit(
      req,
      res,
      PUBLIC_API_THROTTLE_CONFIG,
    );
    if (throttle.blocked) return sendThrottleResponse(res, throttle);
    const config = bookingStripeConfig();
    if (!config)
      return res
        .status(503)
        .send(
          html(
            "Paiement indisponible",
            "<p>Contactez le propriétaire du gîte pour votre règlement.</p>",
          ),
        );
    try {
      await runWithOrganization(
        { organizationId: config.organizationId, source: "public-token" },
        () => work(req, res),
      );
    } catch (error) {
      const known = error instanceof Error && "statusCode" in error;
      const status = known ? Number((error as any).statusCode) : 503;
      res
        .status(status)
        .send(
          html(
            "Paiement indisponible",
            `<p>${escape(known ? (error as Error).message : "La vérification du paiement prend plus de temps que prévu. Réessayez ici dans un instant, sans effectuer un nouveau paiement.")}</p><a class="button" href="${escape(req.baseUrl + "/" + req.params.code)}">Vérifier à nouveau</a>`,
          ),
        );
    }
  };
export const publicReservationPaymentRouter = Router();
publicReservationPaymentRouter.get(
  "/:code",
  withPublicLink(async (req, res) => {
    let link = await loadPaymentLink(String(req.params.code));
    for (const payment of link.payments.filter((row) =>
      ["pending", "creating"].includes(row.status),
    ))
      await refreshPayment(payment.id);
    link = await loadPaymentLink(String(req.params.code));
    if (
      link.status === "requires_review" ||
      link.payments.some((payment) => payment.refunded_amount_cents > 0)
    )
      return res.send(
        html(
          "Paiement reçu — suivi nécessaire",
          "<p>Votre règlement nécessite une vérification par le propriétaire. Aucun nouveau paiement n’est nécessaire.</p>",
        ),
      );
    if (link.status === "paid")
      return res.send(
        html(
          "Votre paiement a bien été reçu",
          `<p>${escape(link.reservation.gite?.nom)}</p><div class="amount">${escape(euro(link.amount_cents))}</div><p>Le règlement est enregistré sur votre réservation. Un email de confirmation vous sera envoyé.</p>`,
        ),
      );
    if (link.status !== "active" || +link.expires_at <= Date.now())
      return res
        .status(410)
        .send(
          html(
            "Lien clôturé ou expiré",
            "<p>Contactez le propriétaire pour obtenir un nouveau lien.</p>",
          ),
        );
    // A GET from a messaging preview or scanner never creates Checkout or initiates a charge.
    const dates = `${link.reservation.date_entree.toLocaleDateString("fr-FR", { timeZone: "UTC" })} au ${link.reservation.date_sortie.toLocaleDateString("fr-FR", { timeZone: "UTC" })}`;
    res.send(
      html(
        "Régler votre réservation",
        `<h2>${escape(link.reservation.gite?.nom)}</h2><p>Du ${escape(dates)}</p><p>${link.purpose === "deposit" ? "Arrhes du séjour" : "Montant restant du séjour"}</p><div class="amount">${escape(euro(link.amount_cents))}</div><form method="post" action="${escape(paymentLinkUrl(link.code))}/checkout"><button type="submit">Payer par carte avec Stripe</button></form><small>Ce lien est valable jusqu’au ${escape(link.expires_at.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }))}. Vos coordonnées bancaires sont saisies directement chez Stripe.</small>`,
      ),
    );
  }),
);
publicReservationPaymentRouter.post(
  "/:code/checkout",
  urlencoded({ extended: false, limit: "2kb" }),
  withPublicLink(async (req, res) => {
    if (
      req.get("origin") &&
      req.get("origin") !==
        new URL(paymentLinkUrl(String(req.params.code))).origin
    )
      return res
        .status(403)
        .send(
          html(
            "Action refusée",
            "<p>Ouvrez le lien de paiement directement pour continuer.</p>",
          ),
        );
    const link = await loadPaymentLink(String(req.params.code));
    for (const payment of link.payments.filter((row) =>
      ["pending", "creating"].includes(row.status),
    ))
      await refreshPayment(payment.id);
    const url = await startReservationLinkCheckout(String(req.params.code));
    res.redirect(303, url);
  }),
);

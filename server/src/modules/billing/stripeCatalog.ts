import Stripe from "stripe";
import { env } from "../../config/env.js";
import { systemPrisma } from "../../db/prisma.js";
import { fromJsonString } from "../../utils/jsonFields.js";

const catalogError = (message: string, code: string) =>
  Object.assign(new Error(message), { status: 409, code });

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  (error as { statusCode?: number }).statusCode === 404;

const periodInterval = (period: string): Stripe.PriceCreateParams.Recurring.Interval =>
  period === "annual" ? "year" : "month";

const assertTestObject = (value: { livemode?: boolean }, label: string) => {
  if (value.livemode) {
    throw catalogError(
      `${label} appartient au mode réel Stripe. La synchronisation pilote est limitée au mode test.`,
      "STRIPE_LIVE_OBJECT_FORBIDDEN",
    );
  }
};

export const getStripeTestConfiguration = () => ({
  mode: "test" as const,
  secretKeyConfigured: Boolean(env.STRIPE_SECRET_KEY),
  webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
  ready: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
});

export class StripeCatalogSynchronizer {
  constructor(private readonly stripe: Stripe) {}

  private async resolveProduct(plan: {
    id: string;
    code: string;
    name: string;
    description: string;
    status: string;
    updatedAt: Date;
    billing_products: Array<{ provider_product_id: string }>;
  }) {
    const mapping = plan.billing_products[0];
    if (mapping) {
      try {
        const existing = await this.stripe.products.retrieve(mapping.provider_product_id);
        if (!("deleted" in existing && existing.deleted)) {
          assertTestObject(existing, "Le produit");
          return await this.stripe.products.update(existing.id, {
            name: plan.name,
            description: plan.description || undefined,
            active: plan.status === "active",
            metadata: { application: "gestion-app", plan_id: plan.id, plan_code: plan.code },
          });
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }

    const created = await this.stripe.products.create(
      {
        name: plan.name,
        description: plan.description || undefined,
        active: plan.status === "active",
        metadata: { application: "gestion-app", plan_id: plan.id, plan_code: plan.code },
      },
      { idempotencyKey: `gestion-plan-product:${plan.id}:${plan.updatedAt.getTime()}` },
    );
    assertTestObject(created, "Le produit créé");
    return created;
  }

  async synchronize(planId: string) {
    const plan = await systemPrisma.plan.findUnique({
      where: { id: planId },
      include: {
        price_definitions: { orderBy: { billing_period: "asc" } },
        billing_products: { where: { provider: "stripe" } },
        billing_prices: { where: { provider: "stripe" }, orderBy: { billing_period: "asc" } },
      },
    });
    if (!plan) throw Object.assign(new Error("Forfait introuvable."), { status: 404, code: "NOT_FOUND" });
    if (plan.code === "legacy_unlimited") {
      throw catalogError("Le forfait historique ne doit pas être publié sur Stripe.", "LEGACY_PLAN_LOCKED");
    }

    const periods = fromJsonString<string[]>(plan.billing_periods, []);
    if (!periods.length) throw catalogError("Sélectionnez au moins une périodicité.", "STRIPE_PERIOD_REQUIRED");
    const definitions = new Map(plan.price_definitions.map((item) => [item.billing_period, item]));
    for (const period of periods) {
      const definition = definitions.get(period);
      if (!definition || definition.amount_cents === null) {
        throw catalogError(`Renseignez le tarif ${period === "annual" ? "annuel" : "mensuel"}.`, "STRIPE_PRICE_REQUIRED");
      }
    }

    const product = await this.resolveProduct(plan);
    await systemPrisma.billingProduct.upsert({
      where: { plan_id_provider: { plan_id: plan.id, provider: "stripe" } },
      update: { provider_product_id: product.id, status: plan.status === "active" ? "active" : "archived" },
      create: { plan_id: plan.id, provider: "stripe", provider_product_id: product.id, status: plan.status === "active" ? "active" : "archived" },
    });

    const desiredActive = plan.status === "active";
    const synchronizedPrices: Array<{ billingPeriod: string; priceId: string; amountCents: number; currency: string; status: string }> = [];
    for (const period of periods) {
      const definition = definitions.get(period)!;
      const current = plan.billing_prices.find((item) => item.billing_period === period);
      let stripePrice: Stripe.Price | null = null;
      if (current) {
        try {
          const retrieved = await this.stripe.prices.retrieve(current.provider_price_id);
          assertTestObject(retrieved, "Le prix");
          const unchanged =
            retrieved.unit_amount === definition.amount_cents &&
            retrieved.currency === definition.currency &&
            retrieved.recurring?.interval === periodInterval(period) &&
            (definition.tax_behavior === "unspecified" || retrieved.tax_behavior === definition.tax_behavior);
          if (unchanged) {
            stripePrice = retrieved.active === desiredActive
              ? retrieved
              : await this.stripe.prices.update(retrieved.id, { active: desiredActive });
          } else if (retrieved.active) {
            await this.stripe.prices.update(retrieved.id, { active: false });
          }
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }

      if (!stripePrice) {
        stripePrice = await this.stripe.prices.create(
          {
            product: product.id,
            currency: definition.currency,
            unit_amount: definition.amount_cents!,
            recurring: { interval: periodInterval(period) },
            active: desiredActive,
            nickname: `${plan.name} — ${period === "annual" ? "annuel" : "mensuel"}`,
            tax_behavior: definition.tax_behavior as Stripe.PriceCreateParams.TaxBehavior,
            metadata: { application: "gestion-app", plan_id: plan.id, plan_code: plan.code, billing_period: period },
          },
          { idempotencyKey: `gestion-plan-price:${plan.id}:${period}:${definition.amount_cents}:${definition.currency}:${definition.tax_behavior}` },
        );
        assertTestObject(stripePrice, "Le prix créé");
      }

      const status = desiredActive ? "active" : "archived";
      await systemPrisma.billingPrice.upsert({
        where: { plan_id_provider_billing_period: { plan_id: plan.id, provider: "stripe", billing_period: period } },
        update: { provider_product_id: product.id, provider_price_id: stripePrice.id, status },
        create: { plan_id: plan.id, provider: "stripe", provider_product_id: product.id, provider_price_id: stripePrice.id, billing_period: period, status },
      });
      synchronizedPrices.push({ billingPeriod: period, priceId: stripePrice.id, amountCents: definition.amount_cents!, currency: definition.currency, status });
    }

    for (const stale of plan.billing_prices.filter((item) => !periods.includes(item.billing_period))) {
      try {
        const price = await this.stripe.prices.retrieve(stale.provider_price_id);
        assertTestObject(price, "Le prix");
        if (price.active) await this.stripe.prices.update(price.id, { active: false });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await systemPrisma.billingPrice.update({ where: { id: stale.id }, data: { status: "archived" } });
    }

    return { mode: "test" as const, productId: product.id, productActive: product.active, prices: synchronizedPrices };
  }
}

export const syncPlanCatalogToStripe = async (planId: string) => {
  if (!env.STRIPE_SECRET_KEY) {
    throw catalogError("Ajoutez STRIPE_SECRET_KEY=sk_test_… dans l’environnement du serveur.", "STRIPE_TEST_KEY_REQUIRED");
  }
  return new StripeCatalogSynchronizer(new Stripe(env.STRIPE_SECRET_KEY)).synchronize(planId);
};

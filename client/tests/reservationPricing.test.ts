import assert from "node:assert/strict";
import test from "node:test";
import {
  computeReservationBaseStayTotalFromAdjustedStay,
  computeReservationPricingPreview,
} from "../src/utils/reservationPricing.ts";

test("computeReservationPricingPreview recalcule le total et le prix/nuit avec une commission fixe", () => {
  const pricing = computeReservationPricingPreview({
    baseStayTotal: 210,
    nights: 3,
    previewOptionsTotal: 0,
    commissionMode: "euro",
    commissionValue: 30,
    remiseMontant: 0,
  });

  assert.equal(pricing.baseStayTotal, 210);
  assert.equal(pricing.baseTotal, 210);
  assert.equal(pricing.commissionAmount, 30);
  assert.equal(pricing.totalAdjustments, 30);
  assert.equal(pricing.adjustedStayTotal, 180);
  assert.equal(pricing.adjustedTotal, 180);
  assert.equal(pricing.adjustedNightlyPrice, 60);
});

test("computeReservationBaseStayTotalFromAdjustedStay retrouve le montant de base avec une commission en pourcentage", () => {
  const baseStayTotal = computeReservationBaseStayTotalFromAdjustedStay({
    adjustedStayTotal: 180,
    previewOptionsTotal: 20,
    commissionMode: "percent",
    commissionValue: 10,
    remiseMontant: 0,
  });

  assert.equal(baseStayTotal, 202.22);
});

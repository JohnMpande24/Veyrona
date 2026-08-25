'use strict';
const db = require('../db/db');

/**
 * Deterministic commercial engine. This file is intentionally free of any
 * AI call — per the transfer package's core operating principle, financial
 * calculations must be enforced by backend code, not invented by a model.
 *
 * Margin rule format (stored as text so it's configurable, Section 20):
 *   "percentage:12"   -> 12% added on top of supplier cost
 *   "fixed:500"        -> flat amount added per quotation (not per line)
 */
function parseMarginRule(rule) {
  const [type, valueStr] = String(rule || 'percentage:12').split(':');
  const value = Number(valueStr);
  if (!['percentage', 'fixed'].includes(type) || Number.isNaN(value)) {
    throw new Error(`Invalid margin_rule: ${rule}`);
  }
  return { type, value };
}

async function getSetting(key, fallback) {
  const row = await db.get('SELECT value FROM system_settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

/**
 * Build customer quotation line items + totals from a verified supplier
 * quotation. Returns computed values only — callers are responsible for
 * persisting and for requiring approval when floors/thresholds are hit.
 */
async function computeQuotation({ supplierQuotationItems, marginRule, taxRatePct = 0, deliveryCharge = 0, discountAmount = 0 }) {
  const { type, value } = parseMarginRule(marginRule);
  const marginFloorPct = Number(await getSetting('customer_margin_floor_pct', '5'));

  let subtotal = 0;
  const lineItems = supplierQuotationItems.map((item) => {
    const unitCost = item.unit_price;
    let unitPrice;
    if (type === 'percentage') {
      unitPrice = unitCost * (1 + value / 100);
    } else {
      // fixed amount is applied at quotation level below; line price = cost for now
      unitPrice = unitCost;
    }
    const lineTotal = round2(unitPrice * item.quantity);
    subtotal += lineTotal;
    return {
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_cost: unitCost,
      unit_price: round2(unitPrice),
      line_total: lineTotal,
    };
  });

  let marginAmount;
  if (type === 'fixed') {
    marginAmount = value;
    subtotal = round2(subtotal + marginAmount);
  } else {
    const costTotal = supplierQuotationItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    marginAmount = round2(subtotal - costTotal);
  }

  const marginPct = subtotal > 0 ? (marginAmount / subtotal) * 100 : 0;
  const requiresApproval = marginPct < marginFloorPct;

  const taxAmount = round2(subtotal * (taxRatePct / 100));
  const grandTotal = round2(subtotal + taxAmount + Number(deliveryCharge) - Number(discountAmount));

  return {
    lineItems,
    subtotal: round2(subtotal),
    marginAmount: round2(marginAmount),
    marginPct: round2(marginPct),
    taxAmount,
    deliveryCharge: Number(deliveryCharge),
    discountAmount: Number(discountAmount),
    grandTotal,
    requiresApproval,
    marginFloorPct,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { computeQuotation, parseMarginRule, getSetting, round2 };

"use strict";

const RATES = Object.freeze({ setup:10, hourly:3, material:0.28, plate:4, minimum:40 });

function finite(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) throw new Error(`Invalid ${name}.`);
  return number;
}

function riskMultiplier({ hours, plates, maxSinglePlateHours = 0 }) {
  const h = finite(hours, "print hours");
  const p = finite(plates, "print plate count", 1);
  const longest = finite(maxSinglePlateHours || 0, "longest plate time");
  let multiplier = h >= 72 || p >= 8 ? 1.15 : h >= 36 || p >= 5 ? 1.10 : h >= 12 || p >= 3 ? 1.05 : 1.00;
  if (longest >= 20) multiplier = Math.max(multiplier, 1.10);
  return multiplier;
}

function manufacturingPrice(input) {
  const hours = finite(input.hours, "print hours");
  const grams = finite(input.grams, "filament grams");
  const plates = finite(input.plates, "print plate count", 1);
  const risk = riskMultiplier({ hours, plates, maxSinglePlateHours:input.maxSinglePlateHours });
  const timeCharge = hours * RATES.hourly;
  const materialCharge = grams * RATES.material;
  const plateCharge = plates * RATES.plate;
  const subtotal = RATES.setup + timeCharge + materialCharge + plateCharge;
  const total = Math.max(RATES.minimum, subtotal * risk);
  const rounded = (value) => Number(value.toFixed(2));
  return {
    setupCharge:RATES.setup,
    timeCharge:rounded(timeCharge), materialCharge:rounded(materialCharge), plateCharge:rounded(plateCharge),
    subtotal:rounded(subtotal), riskMultiplier:risk, total:rounded(total)
  };
}

module.exports = { RATES, manufacturingPrice, riskMultiplier };

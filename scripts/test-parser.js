const assert = require('assert');
const { parseRates, hasCoreRates } = require('../rates');

const sample = `
ЮЖНАЯ КОРЕЯ
1000 KRW = 65.10 1 AED = 23.60
ЯПОНИЯ SWIFT
внутренний перевод 1USD = 90.00
100 JPY = 56.90
ЯПОНИЯ КИТАЙ
100 JPY = 56.90 1 CNY = 13.45
ТАИЛАНД
1THB = 2.74 1USD = 91.50
AFA TRADING
1 JPY = 57.30 1 JPY = 56.90
`;

const rates = parseRates({}, sample);
console.log(rates);
assert.strictEqual(rates.USD_SWIFT, 90);
assert.strictEqual(rates.USD_IDUBID, 91.5);
assert.strictEqual(rates.JPY_INTERNAL, 0.569);
assert.strictEqual(rates.JPY_SWIFT, 0.569);
assert.strictEqual(rates.JPY_CASH, 0.573);
assert.strictEqual(rates.JPY_QR, 0.569);
assert.strictEqual(rates.CNY, 13.45);
assert.strictEqual(rates.KRW, 0.0651);
assert.strictEqual(rates.THB, 2.74);
assert.strictEqual(rates.AED, 23.6);
assert.ok(hasCoreRates(rates));
console.log('Parser test: OK');

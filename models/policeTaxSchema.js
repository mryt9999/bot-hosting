const mongoose = require('mongoose');

/**
 * Police Tax schema for tracking global robbery tax rate
 * This schema enforces a single document to track the active police tax rate
 * Police tax increases based on robbery frequency and amount, with exponential difficulty
 * @typedef {Object} PoliceTaxSchema
 * @property {String} _id - Fixed ID (always 'policeTax')
 * @property {Number} currentTaxRate - Current police tax rate as decimal (0.0 to 1.0)
 * @property {Number} totalRobberyAmount - Total amount stolen (before tax) for tracking trends
 * @property {Number} robberyCount - Number of robberies this period
 * @property {Number} lastUpdatedAt - Timestamp of last tax rate update
 */
const policeTaxSchema = new mongoose.Schema({
    _id: {
        type: String,
        default: 'policeTax',
        immutable: true,
        validate: {
            validator: function (v) {
                return v === 'policeTax';
            },
            message: 'Only one police tax document is allowed'
        }
    },
    currentTaxRate: {
        type: Number,
        default: 0.0,
        min: 0,
        max: 1
    },
    totalRobberyAmount: {
        type: Number,
        default: 0
    },
    robberyCount: {
        type: Number,
        default: 0
    },
    lastUpdatedAt: {
        type: Number,
        default: Date.now
    }
}, { strict: true }); // Enforce schema

module.exports = mongoose.model('PoliceTax', policeTaxSchema);

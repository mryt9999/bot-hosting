const mongoose = require('mongoose');

/**
 * Global Withdraw schema for tracking weekly withdrawals across all users
 * This schema enforces a single document to track global withdrawal limits
 * @typedef {Object} GlobalWithdrawSchema
 * @property {String} _id - Fixed ID (always 'globalWithdraw')
 * @property {Number} totalWithdrawnThisWeek - Total amount withdrawn by all users in the current week
 * @property {Number} temporaryLimitIncrease - Temporary increase to the global withdraw limit
 * @property {Number} weekStartAt - Timestamp marking the start of the current week
 */
const globalWithdrawSchema = new mongoose.Schema({
    _id: {
        type: String,
        default: 'globalWithdraw',
        immutable: true,
        validate: {
            validator: function (v) {
                return v === 'globalWithdraw';
            },
            message: 'Only one global withdraw document is allowed'
        }
    },
    totalWithdrawnThisWeek: {
        type: Number,
        default: 0
    },
    weekStartAt: {
        type: Number,
        default: Date.now
    },
    temporaryLimitIncrease: {
        type: Number,
        default: 0
    }
}, { strict: true }); // Enforce schema

module.exports = mongoose.model('GlobalWithdraw', globalWithdrawSchema);
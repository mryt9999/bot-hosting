const mongoose = require('mongoose');

/**
 * Bank deposit tracker schema
 * Tracks deposits made by one user to another user's bank
 */
const bankSchema = new mongoose.Schema({
    bankOwnerId: { type: String, required: true },
    depositerId: { type: String, required: true },
    serverID: { type: String, required: true },
    amount: { type: Number, required: true },
    depositedAt: { type: Number, required: true },
    _id: false
});

// Compound index for efficient queries
bankSchema.index({ bankOwnerId: 1, depositerId: 1, serverID: 1 });

const model = mongoose.model('bankDeposits', bankSchema);

module.exports = model;

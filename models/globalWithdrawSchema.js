//this is a seperate schema to track global withdraws across all profiles
const mongoose = require('mongoose');
/**
 * Global Withdraw schema for tracking weekly withdrawals across all users
 * @typedef {Object} GlobalWithdrawSchema
 * @property {Number} totalWithdrawnThisWeek - Total amount withdrawn by all users in the current week
 * @property {Number} weekStartAt - Timestamp marking the start of the current week
 */
//make this schema only have one document to track total weekly withdraws
const globalWithdrawSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // Changed from ObjectId to String
    totalWithdrawnThisWeek: { type: Number, default: 0 },
    weekStartAt: { type: Number, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.models.globalWithdraw || mongoose.model('globalWithdraw', globalWithdrawSchema);
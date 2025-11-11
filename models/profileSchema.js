const mongoose = require('mongoose');

/**
 * User profile schema for the economy system
 * @typedef {Object} ProfileSchema
 * @property {string} userId - Discord user ID (unique identifier)
 * @property {string} serverID - Discord server/guild ID
 * @property {number} balance - User's current point balance (default: 100)
 * @property {number} lastDaily - Timestamp of last daily claim in milliseconds (default: 0)
 */
const profileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    serverID: { type: String, required: true },
    balance: { type: Number, default: 100 },
    lastDaily: { type: Number, default: 0 },
});

const model = mongoose.model('economydb', profileSchema);

module.exports = model;

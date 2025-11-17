const mongoose = require('mongoose');

const lotteryCooldownSchema = new mongoose.Schema({
    serverID: { type: String, required: true },
    type: { type: String, enum: ['number', 'raffle'], required: true },
    nextAvailableAt: { type: Date, required: true }
});

module.exports = mongoose.model('LotteryCooldown', lotteryCooldownSchema);
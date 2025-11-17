const mongoose = require('mongoose');

const lotterySchema = new mongoose.Schema({
    serverID: { type: String, required: true },
    type: { type: String, enum: ['number', 'raffle'], required: true }, // 'number' or 'raffle'
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    prizePool: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endsAt: { type: Date }, // Only for raffle type
    winningNumber: { type: Number }, // Only for number type (1-1000)
    usedNumbers: { type: [Number], default: [] }, // Only for number type
    participants: [{
        userId: String,
        number: Number, // Only for number type
        joinedAt: { type: Date, default: Date.now }
    }],
    winnerId: { type: String },
    messageId: { type: String }, // Discord message ID for updating
    channelId: { type: String },
    logThreadId: { type: String }, // Discord thread ID for logs
});

module.exports = mongoose.model('Lottery', lotterySchema);
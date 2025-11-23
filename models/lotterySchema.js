const mongoose = require('mongoose');

const lotterySchema = new mongoose.Schema({
    serverID: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['number', 'raffle', 'animal'], // Added 'animal'
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },
    prizePool: {
        type: Number,
        default: 0
    },
    startedAt: {
        type: Number,
        required: true
    },
    endsAt: {
        type: Number
    },
    endedAt: {
        type: Number
    },
    channelId: {
        type: String,
        required: true
    },
    messageId: {
        type: String
    },
    logThreadId: {
        type: String
    },
    // For number lottery
    winningNumber: {
        type: Number
    },
    usedNumbers: {
        type: [Number],
        default: []
    },
    // For animal lottery
    winningAnimal: {
        type: String
    },
    availableAnimals: {
        type: [String],
        default: []
    },
    // Participants array
    participants: [{
        userId: String,
        username: String,
        timestamp: Number,
        number: Number, // For number lottery
        animal: String  // For animal lottery
    }],
    winnerId: {
        type: String
    },
    winnerIds: {
        type: [String],
        default: []
    },
    archived: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('Lottery', lotterySchema);
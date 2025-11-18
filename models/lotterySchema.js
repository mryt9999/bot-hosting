const mongoose = require('mongoose');

const lotterySchema = new mongoose.Schema({
    serverID: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['number', 'raffle'],
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
    endedAt: {
        type: Number,
        default: null
    },
    endsAt: {
        type: Number,
        default: null
    },
    channelId: {
        type: String,
        required: true
    },
    messageId: {
        type: String,
        default: null
    },
    logThreadId: {
        type: String,
        default: null
    },
    winnerId: {
        type: String,
        default: null
    },
    winningNumber: {
        type: Number,
        default: null
    },
    usedNumbers: {
        type: [Number],
        default: []
    },
    participants: [{
        userId: String,
        number: Number,
        joinedAt: Number
    }],
    archived: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('Lottery', lotterySchema);
const mongoose = require('mongoose');

const activeGameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true
    },
    gameType: {
        type: String,
        required: true,
        enum: ['rps', 'ttt', 'c4']
    },
    serverID: {
        type: String,
        required: true
    },
    challengerId: {
        type: String,
        required: true
    },
    opponentId: {
        type: String,
        required: true
    },
    betAmount: {
        type: Number,
        required: true
    },
    messageId: {
        type: String,
        required: true
    },
    channelId: {
        type: String,
        required: true
    },
    gameState: {
        type: Object,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 3600 // Auto-delete after 1 hour
    }
});

module.exports = mongoose.model('ActiveGame', activeGameSchema);
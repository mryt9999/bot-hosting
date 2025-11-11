const { Events } = require('discord.js');
const profileModel = require('../models/profileSchema');

// Map userId -> { channelId, timestamp }
if (!global.userLastMessageChannel) {
    global.userLastMessageChannel = new Map();
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) {
            return;
        }

        const timestamp = Date.now();
        global.userLastMessageChannel.set(message.author.id, {
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: timestamp
        });

        // Update lastMessageTime in database
        try {
            await profileModel.findOneAndUpdate(
                { userId: message.author.id },
                { $set: { lastMessageTime: timestamp } },
                { upsert: true }
            );
        } catch (err) {
            console.error('Failed to update lastMessageTime:', err);
        }
    }
};
const { Events } = require('discord.js');

// Map userId -> { channelId, timestamp }
if (!global.userLastMessageChannel) global.userLastMessageChannel = new Map();

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

        global.userLastMessageChannel.set(message.author.id, {
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: Date.now()
        });
    }
};
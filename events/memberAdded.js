const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            // Log the new member
            console.log(`${member.user.tag} just joined ${member.guild.name}`);

            // Channel IDs
            const welcomeChannelId = '1434190677490794577'; // Replace with your welcome channel ID
            const rulesChannelId = '1434222454200467577'; // Replace with your rules channel ID
            const botCommandsChannelId = '1434198160330457149'; // Replace with your bot-commands channel ID
            const guideChannelId = '1437905249410224168'; // Replace with your guide channel ID
            const transferLogsChannelId = '1439054372297506816'; // Replace with your transfer logs channel ID

            const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);

            if (welcomeChannel) {
                const welcomeEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setDescription(
                        `👋 Welcome to the server, ${member.user.username}!\n\n` +
                        `📜 Read the rules in <#${rulesChannelId}>\n` +
                        `🤖 Use the \`/help\` command and other commands in <#${botCommandsChannelId}>\n` +
                        `💬 Check the guides in <#${guideChannelId}>\n` +
                        `📁 View transfer logs to see proof in <#${transferLogsChannelId}>`
                    )
                    .setTimestamp();

                await welcomeChannel.send({ embeds: [welcomeEmbed] });
            }

        } catch (error) {
            console.error('Error in guildMemberAdd event:', error);
        }
    },
};
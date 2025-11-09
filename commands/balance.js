const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');


module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('shows your balance'),
    async execute(interaction, profileData, opts = {}) {
        const { balance } = profileData;
        const username = interaction.user.username;
        const avatar = interaction.user.displayAvatarURL({ dynamic: true });
        const ephemeral = !!opts.ephemeral;
        const flags = ephemeral ? { flags: MessageFlags.Ephemeral } : {};

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Wallet`)
            .setColor(0x57F287) // green tint
            .setThumbnail(avatar)
            .addFields(
                { name: 'Balance', value: `💰 ${balance.toLocaleString()} points`, inline: true })
            .setFooter({ text: `Requested by ${username}` })
            .setTimestamp();

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ embeds: [embed], ...flags });
            } else {
                await interaction.followUp({ embeds: [embed], ...flags });
            }
            // Auto-delete the reply after 30 seconds if ephemeral
            if (ephemeral) {
                setTimeout(async () => {
                    try {
                        await interaction.deleteReply();
                    } catch (err) {
                        // ignore
                    }
                }, 30000);
            }
        } catch (err) {
            console.error('Failed to send balance embed:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Error showing balance.', flags: MessageFlags.Ephemeral });
                }
            } catch { }
        }
    },
};
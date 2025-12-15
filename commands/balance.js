const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const { safeReply } = require('../utils/interactionHelper'); // added

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('shows your balance')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to view the balance of')
                .setRequired(false)),
    async execute(interaction, profileData, opts = {}) {
        //create empty variables
        let username;
        let balance;
        let avatar;

        const ephemeral = !!opts.ephemeral;
        const flags = ephemeral ? { flags: MessageFlags.Ephemeral } : {};

        //check if a target player is specified
        try {
            if (interaction.options.getUser('player')) {
                // If a target player is specified, show his balance instead
                const targetUser = interaction.options.getUser('player');
                const targetusername = targetUser.username;
                //get target profile data
                let targetProfileData;
                try {
                    targetProfileData = await profileModel.findOne({ userId: targetUser.id });
                } catch (_err) {
                    console.error('Failed to fetch target profileData:', _err);
                }
                //return if no profile data
                if (!targetProfileData) {
                    const msg = `${targetusername} does not have a profile yet.`;
                    // use safeReply for ephemeral error
                    await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
                    return;
                }
                balance = targetProfileData.balance;
                username = targetUser.username;
                avatar = targetUser.displayAvatarURL({ dynamic: true });
            } else {
                balance = profileData.balance;
                username = interaction.user.username;
                avatar = interaction.user.displayAvatarURL({ dynamic: true });
            }
        } catch (_err) {
            balance = profileData.balance;
            username = interaction.user.username;
            avatar = interaction.user.displayAvatarURL({ dynamic: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Wallet`)
            .setColor(0x57F287) // green tint
            .setThumbnail(avatar)
            .addFields(
                // hide decimals by flooring
                { name: 'Balance', value: `🪙 ${Math.floor(balance).toLocaleString()} points`, inline: true })
            .setFooter({ text: `Requested by ${interaction.user.username}` })
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
                    } catch (_err) {
                        // ignore
                    }
                }, 30000);
            }
        } catch (_err) {
            console.error('Failed to send balance embed:', _err);
            // Use safeReply so Unknown Interaction (10062) is handled gracefully
            await safeReply(interaction, { content: 'Error showing balance.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    },
};
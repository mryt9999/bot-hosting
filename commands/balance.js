const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require("../models/profileSchema");

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
                } catch (err) {
                    console.error('Failed to fetch target profileData:', err);
                }
                //return if no profile data
                if (!targetProfileData) {
                    const msg = `${targetusername} does not have a profile yet.`;
                    if (!interaction.replied && !interaction.deferred) {
                        return await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                    } else {
                        return await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
                    }
                }
                balance = targetProfileData.balance;
                username = targetUser.username;
                avatar = targetUser.displayAvatarURL({ dynamic: true });
            } else {
                balance = profileData.balance;
                username = interaction.user.username;
                avatar = interaction.user.displayAvatarURL({ dynamic: true });
            }
        } catch (err) {
            balance = profileData.balance;
            username = interaction.user.username;
            avatar = interaction.user.displayAvatarURL({ dynamic: true });
        }


        const embed = new EmbedBuilder()
            .setTitle(`${username}'s Wallet`)
            .setColor(0x57F287) // green tint
            .setThumbnail(avatar)
            .addFields(
                { name: 'Balance', value: `🪙 ${balance.toLocaleString()} points`, inline: true })
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
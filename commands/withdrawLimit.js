const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const globalValues = require('../globalValues.json');
const profileModel = require('../models/profileSchema');
const withdrawUtil = require('../utils/withdrawUtil');
const dbUtils = require('../utils/dbUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('withdrawlimit')
        .setDescription('Check weekly withdraw limit status')
        .addStringOption(option =>
            option.setName('global')
                .setDescription('What to view')
                .setRequired(false)
                .addChoices(
                    { name: 'Global Server Limit', value: 'global' }
                ))
        .addUserOption(option =>
            option.setName('player')
                .setDescription('Check another player\'s withdraw limit status (only for personal view)')
                .setRequired(false)),

    async execute(interaction, profileData = null, opts = {}) {
        await interaction.deferReply();

        const viewOption = interaction.options.getString('global') || 'personal'; // Default to personal
        const targetUser = interaction.options.getUser('player') || interaction.user;

        if (viewOption === 'global') {
            // Use withdrawUtil to get and reset global data
            const globalWithdrawData = await withdrawUtil.getGlobalWithdrawData();
            withdrawUtil.resetGlobalWithdrawIfNeeded(globalWithdrawData);
            await globalWithdrawData.save();

            const remaining = globalValues.maxGlobalWithdrawPerWeek - globalWithdrawData.totalWithdrawnThisWeek;
            const resetTimestamp = Math.floor(globalWithdrawData.weekStartAt / 1000) + 7 * 24 * 60 * 60;

            const embed = new EmbedBuilder()
                .setTitle('🌐 Global Weekly Withdraw Limit Status 🌐')
                .setColor(0x3498DB)
                .setTimestamp()
                .setThumbnail(interaction.guild?.iconURL({ dynamic: true, size: 256 })) // Large server icon
                .addFields(
                    {
                        name: 'Total Withdrawn This Week',
                        value: `${globalWithdrawData.totalWithdrawnThisWeek.toLocaleString()} / ${globalValues.maxGlobalWithdrawPerWeek.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: 'Remaining Global Withdraw',
                        value: `${remaining.toLocaleString()} points`,
                        inline: true
                    },
                    {
                        name: 'Week Resets',
                        value: `<t:${resetTimestamp}:R>`,
                        inline: false
                    }
                );

            return await interaction.editReply({ embeds: [embed] });
        }

        // Personal view - Ensure profileData exists with dbUtils
        if (!profileData || targetUser.id !== interaction.user.id) {
            profileData = await dbUtils.ensureProfile(targetUser.id, interaction.guild?.id ?? null);
        }

        // Check user-specific withdraw limit using withdrawUtil
        // First reset if needed (withdrawUtil.canWithdraw does this internally)
        await withdrawUtil.canWithdraw(0, profileData);

        const remaining = globalValues.maxWithdrawPerWeek - profileData.weeklyWithdrawAmount;
        const resetTimestamp = profileData.firstWithdrawAt === 0
            ? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
            : Math.floor(profileData.firstWithdrawAt / 1000) + 7 * 24 * 60 * 60;

        const embed = new EmbedBuilder()
            .setTitle(`💸 ${targetUser.username}'s Weekly Withdraw Limit Status 💸`)
            .setColor(0x3498DB)
            .setTimestamp()
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 })) // Large user avatar
            .addFields(
                {
                    name: 'Total Withdrawn This Week',
                    value: `${profileData.weeklyWithdrawAmount.toLocaleString()} / ${globalValues.maxWithdrawPerWeek.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: 'Remaining Withdraw',
                    value: `${remaining.toLocaleString()} points`,
                    inline: true
                },
                {
                    name: 'Week Resets',
                    value: `<t:${resetTimestamp}:R>`,
                    inline: false
                }
            );

        return await interaction.editReply({ embeds: [embed] });
    }
};
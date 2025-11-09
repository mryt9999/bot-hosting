const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const profileModel = require("../models/profileSchema");
const balanceChangeEvent = require("../events/balanceChange");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Access to all the admin commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand((subcommand) =>
            subcommand
                .setName('addpoints')
                .setDescription('Add points to a players balance')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to add points to')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('The amount of points to add')
                        .setRequired(true)
                        .setMinValue(1)))

        .addSubcommand((subcommand) =>
            subcommand
                .setName('subtractpoints')
                .setDescription('Subtract points from a players balance')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to remove points from')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('The amount of points to subtract')
                        .setRequired(true)
                        .setMinValue(1))),

    async execute(interaction) {
        await interaction.deferReply();

        const adminSubcommand = interaction.options.getSubcommand();

        if (adminSubcommand === 'addpoints') {
            const receiver = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            await profileModel.findOneAndUpdate(
                {
                    userId: receiver.id
                },
                {
                    $inc: {
                        balance: amount,
                    }
                }
            );
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(receiver.id);
            } catch (err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            balanceChangeEvent.execute(targetMember);

            await interaction.editReply(`Successfully added ${amount} points to ${receiver.username}'s balance.`);
        }

        if (adminSubcommand === 'subtractpoints') {
            const receiver = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            await profileModel.findOneAndUpdate(
                {
                    userId: receiver.id
                },
                {
                    $inc: {
                        balance: -amount,
                    }
                }
            );
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(receiver.id);
            } catch (err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            balanceChangeEvent.execute(targetMember);

            await interaction.editReply(`Successfully subtracted ${amount} points from ${receiver.username}'s balance.`);
        }

    },
};

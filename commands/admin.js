const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');
const { completeTask } = require('../utils/taskUtils');

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
                        .setMinValue(1)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('resetpoints')
                .setDescription('Reset a player\'s points')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to reset points for')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('completetask')
                .setDescription('Mark a task as completed for a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player who completed the task')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('taskid')
                        .setDescription('The ID of the task to complete')
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
            } catch (_err) {
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
            } catch (_err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            balanceChangeEvent.execute(targetMember);

            await interaction.editReply(`Successfully subtracted ${amount} points from ${receiver.username}'s balance.`);
        }

        if (adminSubcommand === 'resetpoints') {
            const receiver = interaction.options.getUser('player');
            await profileModel.findOneAndUpdate(
                {
                    userId: receiver.id
                },
                {
                    $set: {
                        balance: 0
                    }
                }
            );

            await interaction.editReply(`Successfully reset ${receiver.username}'s points.`);
        }

        if (adminSubcommand === 'completetask') {
            const player = interaction.options.getUser('player');
            const taskId = interaction.options.getInteger('taskid');
            const serverId = interaction.guild?.id;

            const result = await completeTask(player.id, serverId, taskId);

            if (result.success) {
                // Fire balance change event
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(player.id);
                    balanceChangeEvent.execute(targetMember);
                } catch (_err) {
                    console.error('Failed to fetch target member for balance change event:', _err);
                }

                await interaction.editReply(`✅ Task ${taskId} completed for ${player.username}!\n${result.message}`);
            } else {
                await interaction.editReply(`❌ Failed to complete task: ${result.message}`);
            }
        }
    },
};

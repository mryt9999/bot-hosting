const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');
const taskManager = require('../utils/taskManager');
const configuredTasks = require('../globalValues.json').tasks || {};

const taskChoices = Object.keys(configuredTasks).map((k) => ({ name: k, value: k }));

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
                .setDescription("Reset a player's points")
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to reset points for')
                        .setRequired(true)))
        // New: givetask subcommand
        .addSubcommand((subcommand) =>
            subcommand
                .setName('givetask')
                .setDescription('Give a configured task reward to a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to give the task to')
                        .setRequired(true))
                .addStringOption((option) =>
                    option
                        .setName('taskname')
                        .setDescription('The task to give')
                        .setRequired(true)
                        .addChoices(...taskChoices))
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'addpoints': {
                    const receiver = interaction.options.getUser('player');
                    const amount = interaction.options.getInteger('amount');

                    await profileModel.findOneAndUpdate(
                        { userId: receiver.id },
                        { $inc: { balance: amount }, $setOnInsert: { serverID: interaction.guild?.id ?? null } },
                        { upsert: true, new: true }
                    );

                    let targetMember;
                    try {
                        targetMember = await interaction.guild.members.fetch(receiver.id);
                    } catch (_err) {
                        // ignore: balanceChangeEvent will handle missing member gracefully
                    }

                    // Fire balance change event
                    if (targetMember) {
                        balanceChangeEvent.execute(targetMember);
                    }

                    await interaction.editReply(`Successfully added ${amount} points to ${receiver.username}'s balance.`);
                    break;
                }

                case 'subtractpoints': {
                    const receiver = interaction.options.getUser('player');
                    const amount = interaction.options.getInteger('amount');

                    await profileModel.findOneAndUpdate(
                        { userId: receiver.id },
                        { $inc: { balance: -amount }, $setOnInsert: { serverID: interaction.guild?.id ?? null } },
                        { upsert: true, new: true }
                    );

                    let targetMember;
                    try {
                        targetMember = await interaction.guild.members.fetch(receiver.id);
                    } catch (_err) {
                        // ignore
                    }

                    if (targetMember) {
                        balanceChangeEvent.execute(targetMember);
                    }

                    await interaction.editReply(`Successfully subtracted ${amount} points from ${receiver.username}'s balance.`);
                    break;
                }

                case 'resetpoints': {
                    const receiver = interaction.options.getUser('player');

                    await profileModel.findOneAndUpdate(
                        { userId: receiver.id },
                        { $set: { balance: 0 } },
                        { upsert: true, new: true }
                    );

                    let targetMember;
                    try {
                        targetMember = await interaction.guild.members.fetch(receiver.id);
                    } catch (_err) {
                        // ignore
                    }

                    if (targetMember) {
                        balanceChangeEvent.execute(targetMember);
                    }

                    await interaction.editReply(`Successfully reset ${receiver.username}'s points to 0.`);
                    break;
                }

                case 'givetask': {
                    const receiver = interaction.options.getUser('player', true);
                    const taskName = interaction.options.getString('taskname', true);

                    // Validate task exists
                    const configured = configuredTasks[taskName];
                    if (!configured) {
                        await interaction.editReply({ content: 'That task does not exist.' });
                        break;
                    }

                    // Give the task using the task manager (this will handle weekly window & awarding points)
                    const res = await taskManager.giveTask(receiver.id, taskName, interaction.guild?.id ?? null);

                    if (!res.ok) {
                        if (res.reason === 'invalid_task') {
                            await interaction.editReply({ content: 'That task does not exist.' });
                            break;
                        }
                        if (res.reason === 'max_reached') {
                            await interaction.editReply({
                                content: `This user has already used this task the maximum times this week (${res.max}).`,
                            });
                            break;
                        }
                        // fallback unknown error
                        await interaction.editReply({ content: 'Could not give task (unknown error).' });
                        break;
                    }

                    // try to fetch member for balance-change event and nicer mention
                    let targetMember;
                    try {
                        targetMember = await interaction.guild.members.fetch(receiver.id);
                    } catch (_err) {
                        // ignore
                    }

                    if (targetMember) {
                        balanceChangeEvent.execute(targetMember);
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`Gave task: ${taskName}`)
                        .addFields(
                            { name: 'Player', value: `${receiver.tag} (${receiver.id})`, inline: true },
                            { name: 'New completions (this week)', value: `${res.newCount}/${res.max}`, inline: true },
                            { name: 'Points awarded', value: `${res.addedPoints}`, inline: true },
                            { name: 'Player total balance', value: `${res.userBalance}`, inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;
                }

                default:
                    await interaction.editReply({ content: 'Unknown admin subcommand.' });
            }
        } catch (error) {
            console.error('Error in admin command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'There was an error executing this admin command!', ephemeral: true });
            } else {
                try {
                    await interaction.editReply({ content: 'There was an error executing this admin command!' });
                } catch (_) {
                    // ignore
                }
            }
        }
    },
};
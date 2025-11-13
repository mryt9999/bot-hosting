const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const taskManager = require('../utils/taskManager');

const configuredTasks = require('../globalValues.json').tasks || {};
const taskChoices = Object.keys(configuredTasks).map((k) => ({ name: k, value: k }));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task')
        .setDescription('Task commands')
        .addSubcommand((sub) => sub.setName('list').setDescription('List all tasks and your completions this week'))
        .addSubcommand((sub) =>
            sub
                .setName('info')
                .setDescription('Get detailed info about a task')
                .addStringOption((opt) => opt.setName('taskname').setDescription('Task to view').setRequired(true).addChoices(...taskChoices))
        ),
    // note: interactionCreate passes profileData as second arg; accept it and reuse when present
    async execute(interaction, profileData = null) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            const items = await taskManager.listTasksForUser(interaction.user.id, profileData);

            const embed = new EmbedBuilder().setTitle('Available Tasks').setTimestamp();

            for (const t of items) {
                embed.addFields({
                    name: `${t.taskId} - ${t.userCount}/${t.max} weekly completions done`,
                    value: `${t.description}\nPoints: ${t.points}`,
                });
            }

            return interaction.reply({ embeds: [embed], ephemeral: false });
        }

        if (sub === 'info') {
            const taskName = interaction.options.getString('taskname', true);
            const task = taskManager.getTask(taskName);
            if (!task) return interaction.reply({ content: 'Task not found.', ephemeral: true });

            const userCount = await taskManager.getUserTaskCount(interaction.user.id, taskName, profileData);

            const embed = new EmbedBuilder()
                .setTitle(`Task Info — ${taskName}`)
                .setDescription(task.description || 'No description provided.')
                .addFields(
                    { name: 'Max completions per week', value: String(task.maxCompletionsPerWeek ?? 1), inline: true },
                    { name: 'Your completions this week', value: String(userCount), inline: true },
                    { name: 'Point reward', value: String(task.points ?? 0), inline: true }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: false });
        }

        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    },
};
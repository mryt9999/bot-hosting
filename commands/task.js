const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { listTasksForUser, getTask } = require('../utils/taskManager');
const globalValues = require('../globalValues.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task')
        .setDescription('Task related commands')
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('View all available tasks with your progress'))
        .addSubcommand(sub =>
            sub
                .setName('info')
                .setDescription('Get detailed information about a specific task')
                .addIntegerOption(opt => opt
                    .setName('taskid')
                    .setDescription('ID of the task')
                    .setRequired(true))),
    async execute(interaction, profileData = null, opts = {}) {
        try {
            const sub = interaction.options.getSubcommand();

            if (sub === 'list') {
                // Use profileData if provided to avoid extra DB lookup
                const tasks = await listTasksForUser(interaction.user.id, profileData);

                if (!tasks || tasks.length === 0) {
                    return interaction.reply({ content: 'No tasks are configured.', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle('Available Tasks')
                    .setColor('#2f3136')
                    .setTimestamp();

                for (const t of tasks) {
                    const percent = t.max > 0 ? Math.min(100, Math.round((t.userCount / t.max) * 100)) : 0;
                    const progressBar = `[${'█'.repeat(Math.round(percent / 10))}${'░'.repeat(10 - Math.round(percent / 10))}] ${t.userCount}/${t.max}`;
                    embed.addFields({
                        name: `#${t.taskId} — ${t.description || t.name || 'Unnamed'}`,
                        value: `Reward: ${t.points?.toLocaleString?.() ?? t.points} points\n${progressBar}`,
                    });
                }

                return interaction.reply({ embeds: [embed], ephemeral: true });
            } else if (sub === 'info') {
                const taskId = interaction.options.getInteger('taskid');
                const task = getTask(taskId);

                if (!task) {
                    return interaction.reply({ content: `Task ${taskId} not found.`, ephemeral: true });
                }

                const def = globalValues.taskInfo?.find(x => x.taskId === taskId) || {};
                const embed = new EmbedBuilder()
                    .setTitle(`Task #${taskId} — ${task.name ?? def.taskName ?? 'Task'}`)
                    .setColor('#2f3136')
                    .addFields(
                        { name: 'Description', value: task.description ?? def.taskDescription ?? 'No description provided', inline: false },
                        { name: 'Reward (per completion)', value: `${def.pointRewardPerCompletion ?? task.points ?? 0} points`, inline: true },
                        { name: 'Max completions / week', value: `${def.maxCompletionsPerWeek ?? task.max ?? 'N/A'}`, inline: true }
                    )
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
        } catch (err) {
            console.error('Error executing /task command:', err);
            if (!interaction.replied) {
                return interaction.reply({ content: 'There was an error running that command.', ephemeral: true });
            }
        }
    },
};
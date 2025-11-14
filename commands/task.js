const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const profileModel = require('../models/profileSchema');
const globalValues = require('../globalValues.json');
const taskManager = require('../utils/taskManager');
const dbUtils = require('../utils/dbUtils');

// Generate task choices from globalValues
const taskChoices = Object.values(globalValues.taskInfo).map(task => ({
    name: task.taskName,
    value: task.taskName
}));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task')
        .setDescription('Manage and view tasks')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all available tasks'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get info about a specific task')
                .addStringOption(option =>
                    option
                        .setName('taskname')
                        .setDescription('The name of the task')
                        .setRequired(true)
                        .addChoices(...taskChoices))), // ADD THIS LINE

    async execute(interaction, profileData = null, opts = {}) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const subcommand = interaction.options.getSubcommand();

        // Ensure profileData exists
        if (!profileData) {
            profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild?.id ?? null);
        }
        // Ensure all tasks are present in user profile
        await taskManager.ensureUserTasks(profileData);
        // Reset weekly tasks if needed
        for (const taskEntry of profileData.tasks) {
            taskManager.resetWeeklyTaskIfNeeded(taskEntry);
        }
        await profileData.save();

        if (subcommand === 'list') {
            const embed = new EmbedBuilder()
                .setTitle('📋 Task List 📋')
                .setColor(0x3498DB)
                .setTimestamp();
            for (const [_, taskDef] of Object.entries(globalValues.taskInfo)) {
                const taskEntry = profileData.tasks.find(t => t.taskId === taskDef.taskId);
                const completions = taskEntry ? taskEntry.completions : 0;
                const firstCompletion = taskEntry ? taskEntry.firstCompletionAt : 0;

                if (firstCompletion === 0) {
                    embed.addFields({
                        name: taskDef.taskName,
                        value: `Completions: ${completions} / ${taskDef.maxCompletionsPerWeek}`,
                        inline: false
                    });
                    continue;
                }

                const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
                const now = Date.now();
                const timeSinceFirstCompletion = now - firstCompletion;

                if (timeSinceFirstCompletion >= oneWeekMs) {
                    embed.addFields({
                        name: taskDef.taskName,
                        value: `Completions: ${completions} / ${taskDef.maxCompletionsPerWeek}`,
                        inline: false
                    });
                    continue;
                }

                const timeUntilResetMs = oneWeekMs - timeSinceFirstCompletion;
                const daysUntilReset = Math.floor(timeUntilResetMs / (24 * 60 * 60 * 1000));
                const hoursUntilReset = Math.floor((timeUntilResetMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                const resetTimeString = `${daysUntilReset} days and ${hoursUntilReset} hours`;

                embed.addFields({
                    name: taskDef.taskName,
                    value: `Completions: ${completions} / ${taskDef.maxCompletionsPerWeek} - Resets in: ${resetTimeString}`,
                    inline: false
                });
            }
            return interaction.editReply({ embeds: [embed] });
        }
        else if (subcommand === 'info') {
            const taskName = interaction.options.getString('taskname');
            const taskId = taskManager.getTaskIdByName(taskName);

            if (!taskId) {
                return interaction.editReply(`Task "${taskName}" not found.`);
            }

            const taskDef = Object.values(globalValues.taskInfo).find(t => t.taskId === taskId);
            const taskEntry = profileData.tasks.find(t => t.taskId === taskId);
            const completions = taskEntry ? taskEntry.completions : 0;

            // Calculate when the task will reset
            let completionsDisplay = `${completions}`; // FIXED: Store as string separately
            const firstCompletion = taskEntry ? taskEntry.firstCompletionAt : 0;

            if (firstCompletion !== 0) {
                const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
                const now = Date.now();
                const timeSinceFirstCompletion = now - firstCompletion;

                if (timeSinceFirstCompletion < oneWeekMs) {
                    const timeUntilResetMs = oneWeekMs - timeSinceFirstCompletion;
                    const daysUntilReset = Math.floor(timeUntilResetMs / (24 * 60 * 60 * 1000));
                    const hoursUntilReset = Math.floor((timeUntilResetMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                    const resetTimeString = `${daysUntilReset} days and ${hoursUntilReset} hours`;
                    completionsDisplay = `${completions} / ${taskDef.maxCompletionsPerWeek} (resets in ${resetTimeString})`; // FIXED: Don't modify the number directly
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(`📋 Task Info: ${taskDef.taskName} 📋`)
                .setColor(0x3498DB)
                .addFields(
                    { name: 'Task Name', value: taskDef.taskName, inline: false },
                    { name: 'Completions', value: `${completionsDisplay}`, inline: false },
                    { name: 'Point Reward', value: `${taskDef.pointRewardPerCompletion} points`, inline: false },
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }
    },
};
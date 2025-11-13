const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const taskModel = require('../models/taskSchema');
const globalValues = require('../globalValues.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task')
        .setDescription('View available tasks and track your progress')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all available tasks'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get detailed information about a specific task')
                .addIntegerOption(option =>
                    option.setName('taskid')
                        .setDescription('The ID of the task')
                        .setRequired(true)
                        .setMinValue(1))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'list') {
            return await handleList(interaction);
        } else if (subcommand === 'info') {
            return await handleInfo(interaction);
        }
    },
};

async function handleList(interaction) {
    const userId = interaction.user.id;
    const serverId = interaction.guild?.id;

    // Get all tasks from globalValues.json
    const tasks = globalValues.taskInfo || [];

    if (tasks.length === 0) {
        return await interaction.reply({
            content: 'No tasks are currently available.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Get user's task completion data
    const userTasks = await taskModel.find({
        userId: userId,
        serverID: serverId
    });

    // Create a map for quick lookup
    const taskProgressMap = new Map();
    for (const userTask of userTasks) {
        // Check if week has passed and reset if needed
        const weekStart = getWeekStart();
        if (userTask.weekStartDate < weekStart) {
            userTask.completionsThisWeek = 0;
            userTask.weekStartDate = weekStart;
            await userTask.save();
        }
        taskProgressMap.set(userTask.taskId, userTask.completionsThisWeek);
    }

    // Build embed
    const embed = new EmbedBuilder()
        .setTitle('📋 Available Tasks')
        .setColor(0x3498DB)
        .setDescription('Complete tasks to earn bonus points! Progress resets weekly on Mondays.')
        .setTimestamp();

    // Add fields for each task
    for (const task of tasks) {
        const completions = taskProgressMap.get(task.taskId) || 0;
        const maxCompletions = task.maxCompletionsPerWeek;
        const reward = task.pointRewardPerCompletion;
        const progressBar = createProgressBar(completions, maxCompletions);

        const fieldValue = [
            `**Reward:** 🪙 ${reward.toLocaleString()} points per completion`,
            `**Progress:** ${progressBar} ${completions}/${maxCompletions} this week`,
            `**Task ID:** \`${task.taskId}\``
        ].join('\n');

        embed.addFields({
            name: `${getTaskEmoji(task.taskName)} ${formatTaskName(task.taskName)}`,
            value: fieldValue,
            inline: false
        });
    }

    embed.setFooter({ text: 'Use /task info <taskid> for more details about a specific task' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleInfo(interaction) {
    const taskId = interaction.options.getInteger('taskid');
    const userId = interaction.user.id;
    const serverId = interaction.guild?.id;

    // Find the task in globalValues.json
    const tasks = globalValues.taskInfo || [];
    const task = tasks.find(t => t.taskId === taskId);

    if (!task) {
        return await interaction.reply({
            content: `Task with ID \`${taskId}\` does not exist. Use \`/task list\` to see all available tasks.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Get user's progress for this task
    const userTask = await taskModel.findOne({
        userId: userId,
        serverID: serverId,
        taskId: taskId
    });

    let completions = 0;
    let lastCompletion = null;

    if (userTask) {
        // Check if week has passed and reset if needed
        const weekStart = getWeekStart();
        if (userTask.weekStartDate < weekStart) {
            userTask.completionsThisWeek = 0;
            userTask.weekStartDate = weekStart;
            userTask.lastCompletionDate = null;
            await userTask.save();
        }
        completions = userTask.completionsThisWeek;
        lastCompletion = userTask.lastCompletionDate;
    }

    const maxCompletions = task.maxCompletionsPerWeek;
    const reward = task.pointRewardPerCompletion;
    const progressBar = createProgressBar(completions, maxCompletions);
    const remainingCompletions = Math.max(0, maxCompletions - completions);
    const potentialEarnings = remainingCompletions * reward;

    // Build detailed embed
    const embed = new EmbedBuilder()
        .setTitle(`${getTaskEmoji(task.taskName)} ${formatTaskName(task.taskName)}`)
        .setColor(completions >= maxCompletions ? 0x2ECC71 : 0x3498DB)
        .setDescription(getTaskDescription(task.taskName))
        .addFields(
            { name: '💰 Reward', value: `🪙 ${reward.toLocaleString()} points per completion`, inline: true },
            { name: '🔄 Weekly Limit', value: `${maxCompletions} completions`, inline: true },
            { name: '📊 Your Progress', value: `${progressBar}\n${completions}/${maxCompletions} completions this week`, inline: false },
            { name: '✨ Potential Earnings', value: `🪙 ${potentialEarnings.toLocaleString()} points (${remainingCompletions} remaining)`, inline: true }
        );

    if (lastCompletion) {
        embed.addFields({
            name: '🕒 Last Completion',
            value: `<t:${Math.floor(lastCompletion.getTime() / 1000)}:R>`,
            inline: true
        });
    }

    if (completions >= maxCompletions) {
        embed.addFields({
            name: '✅ Status',
            value: 'You have completed this task the maximum number of times this week!',
            inline: false
        });
    }

    const weekStart = getWeekStart();
    const nextMonday = new Date(weekStart);
    nextMonday.setDate(nextMonday.getDate() + 7);

    embed.setFooter({ text: `Weekly progress resets on: ${nextMonday.toUTCString()}` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Get the start of the current week (Monday at 00:00:00 UTC)
 */
function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
}

/**
 * Create a visual progress bar
 */
function createProgressBar(current, max, length = 10) {
    const percentage = Math.min(current / max, 1);
    const filled = Math.floor(percentage * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get emoji for task type
 */
function getTaskEmoji(taskName) {
    const emojiMap = {
        'PublicDonation': '💝',
        'ServerDonation': '🎁',
        'PublicGiveaway': '🎉',
        'ServerGiveaway': '🎊',
        'TeamGrinding': '⚔️'
    };
    return emojiMap[taskName] || '📌';
}

/**
 * Format task name for display
 */
function formatTaskName(taskName) {
    // Convert camelCase to separate words
    return taskName.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Get description for task
 */
function getTaskDescription(taskName) {
    const descriptions = {
        'PublicDonation': 'Make a donation in a public channel to help other players and earn rewards!',
        'ServerDonation': 'Make a donation to support the server and earn bonus points!',
        'PublicGiveaway': 'Host a public giveaway event for the community!',
        'ServerGiveaway': 'Host a server-wide giveaway to spread the joy!',
        'TeamGrinding': 'Team up with other players and grind together for rewards!'
    };
    return descriptions[taskName] || 'Complete this task to earn points!';
}

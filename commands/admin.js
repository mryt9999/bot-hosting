const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const profileModel = require('../models/profileSchema');
const balanceChangeEvent = require('../events/balanceChange');
const globalValues = require('../globalValues.json');
const taskManager = require('../utils/taskManager');
const withdrawUtil = require('../utils/withdrawUtil');

// Generate task choices from globalValues
const taskChoices = Object.values(globalValues.taskInfo).map(task => ({
    name: task.taskName,
    value: task.taskName
}));

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
                .setName('givetask')
                .setDescription('Give a task completion to a player')
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
                        .addChoices(...taskChoices)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('withdrawfrom')
                .setDescription('Withdraw points from a player (respects withdraw limits)')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to withdraw points from')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('The amount of points to withdraw')
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
                    },
                    $setOnInsert: {
                        serverID: interaction.guild?.id ?? null
                    }
                },
                { upsert: true }
            );
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(receiver.id);
            } catch (err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            if (targetMember) {
                balanceChangeEvent.execute(targetMember);
            }

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
                    },
                    $setOnInsert: {
                        serverID: interaction.guild?.id ?? null
                    }
                },
                { upsert: true }
            );
            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(receiver.id);
            } catch (err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            if (targetMember) {
                balanceChangeEvent.execute(targetMember);
            }

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
                    },
                    $setOnInsert: {
                        serverID: interaction.guild?.id ?? null
                    }
                },
                { upsert: true }
            );

            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(receiver.id);
            } catch (err) {
                console.error('Failed to fetch target member for balance change event:', err);
            }
            // FIRE BALANCE CHANGE EVENT
            if (targetMember) {
                balanceChangeEvent.execute(targetMember);
            }

            await interaction.editReply(`Successfully reset ${receiver.username}'s points.`);
        }

        if (adminSubcommand === 'givetask') {
            const receiver = interaction.options.getUser('player');
            const taskName = interaction.options.getString('taskname');

            try {
                // Get task ID from task name
                const taskId = taskManager.getTaskIdByName(taskName);
                if (!taskId) {
                    return await interaction.editReply(`Task "${taskName}" not found.`);
                }

                // Get or create user profile
                let profileData = await profileModel.findOne({ userId: receiver.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: receiver.id,
                        serverID: interaction.guild?.id ?? null,
                        tasks: []
                    });
                }

                // Ensure all tasks are present in user profile
                await taskManager.ensureUserTasks(profileData);

                // Find the task entry
                let taskEntry = profileData.tasks.find(t => t.taskId === taskId);
                if (!taskEntry) {
                    // This shouldn't happen after ensureUserTasks, but just in case
                    console.warn(`Task entry for taskId "${taskId}" not found in user profile after ensureUserTasks.`);
                    taskEntry = {
                        taskId: taskId,
                        completions: 0,
                        firstCompletionAt: 0
                    };
                    profileData.tasks.push(taskEntry);
                }

                // Reset weekly task if needed
                taskManager.resetWeeklyTaskIfNeeded(taskEntry);

                // Get task definition
                const taskDef = Object.values(globalValues.taskInfo).find(t => t.taskId === taskId);
                if (!taskDef) {
                    return await interaction.editReply(`Task definition for "${taskName}" not found.`);
                }

                // Check if max completions reached
                if (taskEntry.completions >= taskDef.maxCompletionsPerWeek) {
                    return await interaction.editReply(
                        `${receiver.username} has already completed "${taskName}" the maximum number of times this week (${taskDef.maxCompletionsPerWeek}).`
                    );
                }

                // Set first completion time if this is the first completion
                if (taskEntry.completions === 0) {
                    taskEntry.firstCompletionAt = Date.now();
                }

                // Increment completions
                taskEntry.completions += 1;

                // Award points
                profileData.balance += taskDef.pointRewardPerCompletion;

                // Save profile
                await profileData.save();

                // Fire balance change event
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(receiver.id);
                    balanceChangeEvent.execute(targetMember);
                } catch (err) {
                    console.error('Failed to fetch target member for balance change event:', err);
                }

                await interaction.editReply(
                    `Successfully gave "${taskName}" task to ${receiver.username}.\n` +
                    `Completions: ${taskEntry.completions}/${taskDef.maxCompletionsPerWeek}\n` +
                    `Points awarded: ${taskDef.pointRewardPerCompletion}`
                );

            } catch (error) {
                console.error('Error giving task:', error);
                await interaction.editReply('An error occurred while giving the task. Please try again.');
            }
        }

        if (adminSubcommand === 'withdrawfrom') {
            const receiver = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            try {
                // Get or create user profile
                let profileData = await profileModel.findOne({ userId: receiver.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: receiver.id,
                        serverID: interaction.guild?.id ?? null
                    });
                }

                // Check if user has enough balance
                if (profileData.balance < amount) {
                    return await interaction.editReply(
                        `${receiver.username} only has ${profileData.balance.toLocaleString()} points. Cannot withdraw ${amount.toLocaleString()} points.`
                    );
                }

                // Check if withdrawal is allowed (respects weekly limits)
                const canWithdrawResult = await withdrawUtil.canWithdraw(amount, profileData);
                if (!canWithdrawResult.allowed) {
                    return await interaction.editReply(
                        `Cannot withdraw from ${receiver.username}: ${canWithdrawResult.reason}`
                    );
                }

                // Process the withdrawal
                await withdrawUtil.processWithdrawal(amount, profileData);

                // Subtract points from balance
                profileData.balance -= amount;
                await profileData.save();

                // Fire balance change event
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(receiver.id);
                    balanceChangeEvent.execute(targetMember);
                } catch (err) {
                    console.error('Failed to fetch target member for balance change event:', err);
                }

                await interaction.editReply(
                    `Successfully withdrew ${amount.toLocaleString()} points from ${receiver.username}.\n` +
                    `New balance: ${profileData.balance.toLocaleString()} points\n` +
                    `Weekly withdrawn: ${profileData.weeklyWithdrawAmount.toLocaleString()} / ${globalValues.maxWithdrawPerWeek.toLocaleString()} points`
                );

            } catch (error) {
                console.error('Error processing withdrawal:', error);
                await interaction.editReply('An error occurred while processing the withdrawal. Please try again.');
            }
        }

    },
};
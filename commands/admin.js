const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const profileModel = require('../models/profileSchema');
const globalValues = require('../globalValues.json');
const taskManager = require('../utils/taskManager');
const withdrawUtil = require('../utils/withdrawUtil');
const { updateBalance, setBalance } = require('../utils/dbUtils');

// Generate task choices from globalValues
const taskChoices = Object.values(globalValues.taskInfo).map(task => ({
    name: task.taskName,
    value: task.taskName
}));

// Your user ID - replace with your actual Discord user ID
const OWNER_USER_ID = '984131525715054653'; //owner's user ID to dm

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
                        .setMinValue(1)))

        .addSubcommand((subcommand) =>
            subcommand
                .setName('addglobalwithdrawlimit')
                .setDescription('Increase the global weekly withdraw limit by a specified amount')
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('The amount to add to the global withdraw limit')
                        .setRequired(true)
                        .setMinValue(1))),

    async execute(interaction) {
        await interaction.deferReply();

        const adminSubcommand = interaction.options.getSubcommand();

        // Function to notify owner
        async function notifyOwner(commandName, details) {
            if (interaction.user.id !== OWNER_USER_ID) {
                try {
                    const owner = await interaction.client.users.fetch(OWNER_USER_ID);
                    await owner.send(
                        `🚨 **Admin Command Used**\n\n` +
                        `**User:** ${interaction.user.tag} (${interaction.user.id})\n` +
                        `**Server:** ${interaction.guild?.name || 'Unknown'}\n` +
                        `**Command:** /admin ${commandName}\n` +
                        `**Details:** ${details}`
                    );
                } catch (error) {
                    console.error('Failed to send DM notification to owner:', error);
                }
            }
        }

        if (adminSubcommand === 'addpoints') {
            const receiver = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            const updateResult = await updateBalance(
                receiver.id,
                amount,
                { interaction },
                { serverId: interaction.guild?.id ?? null }
            );

            if (!updateResult.success) {
                await interaction.editReply(`Failed to add points: ${updateResult.reason}`);
                return;
            }

            // Notify owner
            await notifyOwner('addpoints', `Added ${amount.toLocaleString()} points to ${receiver.tag} (${receiver.id})`);

            await interaction.editReply(`Successfully added ${amount} points to ${receiver.username}'s balance.`);
        }

        if (adminSubcommand === 'subtractpoints') {
            const receiver = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');

            const updateResult = await updateBalance(
                receiver.id,
                -amount,
                { interaction },
                { serverId: interaction.guild?.id ?? null, checkBalance: false }
            );

            if (!updateResult.success) {
                await interaction.editReply(`Failed to subtract points: ${updateResult.reason}`);
                return;
            }

            // Notify owner
            await notifyOwner('subtractpoints', `Subtracted ${amount.toLocaleString()} points from ${receiver.tag} (${receiver.id})`);

            await interaction.editReply(`Successfully subtracted ${amount} points from ${receiver.username}'s balance.`);
        }

        if (adminSubcommand === 'resetpoints') {
            const receiver = interaction.options.getUser('player');

            //we also need to nofifyOwner of the amount of points reset
            const profileData = await profileModel.findOne({ userId: receiver.id });
            const previousBalance = profileData ? profileData.balance : 0;

            const updateResult = await setBalance(
                receiver.id,
                0,
                { interaction },
                { serverId: interaction.guild?.id ?? null }
            );

            if (!updateResult.success) {
                await interaction.editReply(`Failed to reset points: ${updateResult.reason}`);
                return;
            }

            // Notify owner
            await notifyOwner('resetpoints', `Reset ${previousBalance} points for ${receiver.tag} (${receiver.id})`);

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

                // Save profile with task updates
                await profileData.save();

                // Award points using the utility function
                const updateResult = await updateBalance(
                    receiver.id,
                    taskDef.pointRewardPerCompletion,
                    { interaction },
                    { serverId: interaction.guild?.id ?? null }
                );

                if (!updateResult.success) {
                    return await interaction.editReply(`Failed to award points for task: ${updateResult.reason}`);
                }

                const embed = new EmbedBuilder()
                    .setColor(0x00FF00) // Green color for success
                    .setTitle(`✅ ${receiver.tag} Completed Task`)
                    .setDescription(`**${taskName}** completion given to ${receiver.username}\n ${taskEntry.completions}/${taskDef.maxCompletionsPerWeek} completions \n Reward: ${taskDef.pointRewardPerCompletion.toLocaleString()} points`)
                    .setFooter({ text: receiver.username, iconURL: receiver.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

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

                // Subtract points from balance using utility function
                const updateResult = await updateBalance(
                    receiver.id,
                    -amount,
                    { interaction },
                    { serverId: interaction.guild?.id ?? null, checkBalance: false }
                );

                if (!updateResult.success) {
                    return await interaction.editReply(`Failed to withdraw points: ${updateResult.reason}`);
                }

                // Refresh profile data to get updated balance
                profileData = await profileModel.findOne({ userId: receiver.id });

                await notifyOwner('withdrawfrom', `withdrew ${amount.toLocaleString()} points from ${receiver.tag} (${receiver.id})`);

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

        if (adminSubcommand === 'addglobalwithdrawlimit') {
            const amount = interaction.options.getInteger('amount');

            try {
                // Get global withdraw data
                const globalWithdrawData = await withdrawUtil.getGlobalWithdrawData();

                // Store previous limit for notification
                const previousLimit = globalValues.maxGlobalWithdrawPerWeek;
                const previousRemaining = previousLimit - globalWithdrawData.totalWithdrawnThisWeek;

                // Increase the global limit temporarily (stored in database)
                globalWithdrawData.temporaryLimitIncrease = (globalWithdrawData.temporaryLimitIncrease || 0) + amount;
                await globalWithdrawData.save();

                const newLimit = previousLimit + globalWithdrawData.temporaryLimitIncrease;
                const newRemaining = newLimit - globalWithdrawData.totalWithdrawnThisWeek;

                // Create success embed
                const embed = new EmbedBuilder()
                    .setTitle('✅ Global Withdraw Limit Increased')
                    .setColor(0x2ECC71)
                    .setDescription(`The global weekly withdraw limit has been increased by **${amount.toLocaleString()}** points.`)
                    .addFields(
                        {
                            name: 'Previous Limit',
                            value: `${previousLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'New Limit',
                            value: `${newLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Amount Added',
                            value: `+${amount.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Previous Remaining',
                            value: `${previousRemaining.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'New Remaining',
                            value: `${newRemaining.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Total Withdrawn This Week',
                            value: `${globalWithdrawData.totalWithdrawnThisWeek.toLocaleString()} points`,
                            inline: true
                        }
                    )
                    .setFooter({ text: 'This increase will reset at the start of next week' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

                // Notify owner
                await notifyOwner(
                    'addglobalwithdrawlimit',
                    `Increased global withdraw limit by ${amount.toLocaleString()} points (from ${previousLimit.toLocaleString()} to ${newLimit.toLocaleString()})`
                );

            } catch (error) {
                console.error('Error increasing global withdraw limit:', error);
                await interaction.editReply('An error occurred while increasing the global withdraw limit. Please try again.');
            }
        }

    },
};
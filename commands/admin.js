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
                        .setMinValue(1)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('changewithdrawlimit')
                .setDescription('Change a player\'s weekly withdraw limit')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to modify withdraw limit for')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('add')
                        .setDescription('Amount to add to their withdraw limit')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption((option) =>
                    option
                        .setName('subtract')
                        .setDescription('Amount to subtract from their withdraw limit')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption((option) =>
                    option
                        .setName('reset')
                        .setDescription('Reset to this amount (0 to reset to default)')
                        .setRequired(false)
                        .setMinValue(0))),

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

            await notifyOwner('addpoints', `Added ${amount.toLocaleString()} points to ${receiver.tag} (${receiver.id})`);
            await interaction.editReply(`Successfully added ${amount.toLocaleString()} points to ${receiver.username}'s balance.`);
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

            await notifyOwner('subtractpoints', `Subtracted ${amount.toLocaleString()} points from ${receiver.tag} (${receiver.id})`);
            await interaction.editReply(`Successfully subtracted ${amount.toLocaleString()} points from ${receiver.username}'s balance.`);
        }

        if (adminSubcommand === 'resetpoints') {
            const receiver = interaction.options.getUser('player');

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

            await notifyOwner('resetpoints', `Reset ${previousBalance.toLocaleString()} points for ${receiver.tag} (${receiver.id})`);
            await interaction.editReply(`Successfully reset ${receiver.username}'s points.`);
        }

        if (adminSubcommand === 'givetask') {
            const receiver = interaction.options.getUser('player');
            const taskName = interaction.options.getString('taskname');

            try {
                const taskId = taskManager.getTaskIdByName(taskName);
                if (!taskId) {
                    return await interaction.editReply(`Task "${taskName}" not found.`);
                }

                let profileData = await profileModel.findOne({ userId: receiver.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: receiver.id,
                        serverID: interaction.guild?.id ?? null,
                        tasks: []
                    });
                }

                await taskManager.ensureUserTasks(profileData);

                let taskEntry = profileData.tasks.find(t => t.taskId === taskId);
                if (!taskEntry) {
                    console.warn(`Task entry for taskId "${taskId}" not found in user profile after ensureUserTasks.`);
                    taskEntry = {
                        taskId: taskId,
                        completions: 0,
                        firstCompletionAt: 0
                    };
                    profileData.tasks.push(taskEntry);
                }

                taskManager.resetWeeklyTaskIfNeeded(taskEntry);

                const taskDef = Object.values(globalValues.taskInfo).find(t => t.taskId === taskId);
                if (!taskDef) {
                    return await interaction.editReply(`Task definition for "${taskName}" not found.`);
                }

                if (taskEntry.completions >= taskDef.maxCompletionsPerWeek) {
                    return await interaction.editReply(
                        `${receiver.username} has already completed "${taskName}" the maximum number of times this week (${taskDef.maxCompletionsPerWeek}).`
                    );
                }

                if (taskEntry.completions === 0) {
                    taskEntry.firstCompletionAt = Date.now();
                }

                taskEntry.completions += 1;
                await profileData.save();

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
                    .setColor(0x00FF00)
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
                let profileData = await profileModel.findOne({ userId: receiver.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: receiver.id,
                        serverID: interaction.guild?.id ?? null
                    });
                }

                if (profileData.balance < amount) {
                    return await interaction.editReply(
                        `${receiver.username} only has ${profileData.balance.toLocaleString()} points. Cannot withdraw ${amount.toLocaleString()} points.`
                    );
                }

                const canWithdrawResult = await withdrawUtil.canWithdraw(amount, profileData);
                if (!canWithdrawResult.allowed) {
                    return await interaction.editReply(
                        `Cannot withdraw from ${receiver.username}: ${canWithdrawResult.reason}`
                    );
                }

                // Process withdrawal tracking FIRST (updates profileData in memory)
                await withdrawUtil.processWithdrawal(amount, profileData);

                // Subtract balance and save the profile (includes withdrawal tracking updates)
                profileData.balance -= amount;
                await profileData.save();

                // Fire balance change event
                let targetMember;
                try {
                    targetMember = await interaction.guild.members.fetch(receiver.id);
                    const balanceChangeEvent = require('../events/balanceChange');
                    balanceChangeEvent.execute(targetMember);
                } catch (err) {
                    console.error('Failed to fetch target member for balance change event:', err);
                }

                await notifyOwner('withdrawfrom', `Withdrew ${amount.toLocaleString()} points from ${receiver.tag} (${receiver.id})`);

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
                const globalWithdrawModel = require('../models/globalWithdrawSchema');

                let globalWithdrawData = await globalWithdrawModel.findById('globalWithdraw');

                if (!globalWithdrawData) {
                    globalWithdrawData = await globalWithdrawModel.create({
                        _id: 'globalWithdraw',
                        totalWithdrawnThisWeek: 0,
                        weekStartAt: Date.now(),
                        temporaryLimitIncrease: 0
                    });
                }

                // Initialize field if it doesn't exist
                if (typeof globalWithdrawData.temporaryLimitIncrease === 'undefined') {
                    globalWithdrawData.temporaryLimitIncrease = 0;
                    await globalWithdrawData.save();
                }

                const previousTemporaryIncrease = globalWithdrawData.temporaryLimitIncrease;
                const previousLimit = globalValues.maxGlobalWithdrawPerWeek + previousTemporaryIncrease;
                const previousRemaining = previousLimit - globalWithdrawData.totalWithdrawnThisWeek;

                // Update using findByIdAndUpdate for atomic operation
                const updatedData = await globalWithdrawModel.findByIdAndUpdate(
                    'globalWithdraw',
                    {
                        $inc: { temporaryLimitIncrease: amount }
                    },
                    {
                        new: true,
                        runValidators: true
                    }
                );

                const newTemporaryIncrease = updatedData.temporaryLimitIncrease;
                const newLimit = globalValues.maxGlobalWithdrawPerWeek + newTemporaryIncrease;
                const newRemaining = newLimit - updatedData.totalWithdrawnThisWeek;
                const resetTimestamp = Math.floor(updatedData.weekStartAt / 1000) + 7 * 24 * 60 * 60;

                const embed = new EmbedBuilder()
                    .setTitle('✅ Global Withdraw Limit Increased')
                    .setColor(0x2ECC71)
                    .setDescription(`The global weekly withdraw limit has been increased by **${amount.toLocaleString()}** points.`)
                    .addFields(
                        {
                            name: 'Base Limit',
                            value: `${globalValues.maxGlobalWithdrawPerWeek.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Temporary Bonus',
                            value: `${previousTemporaryIncrease.toLocaleString()} → ${newTemporaryIncrease.toLocaleString()} points (+${amount.toLocaleString()})`,
                            inline: true
                        },
                        {
                            name: '\u200B',
                            value: '\u200B',
                            inline: true
                        },
                        {
                            name: 'Total Limit',
                            value: `${previousLimit.toLocaleString()} → ${newLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Remaining',
                            value: `${previousRemaining.toLocaleString()} → ${newRemaining.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Withdrawn This Week',
                            value: `${updatedData.totalWithdrawnThisWeek.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Week Resets',
                            value: `<t:${resetTimestamp}:R>`,
                            inline: false
                        }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

                await notifyOwner(
                    'addglobalwithdrawlimit',
                    `Increased global withdraw limit by ${amount.toLocaleString()} points. New temporary bonus: ${newTemporaryIncrease.toLocaleString()} points (total limit: ${newLimit.toLocaleString()} points)`
                );

            } catch (error) {
                console.error('Error increasing global withdraw limit:', error);
                await interaction.editReply('An error occurred while increasing the global withdraw limit. Please try again.');
            }
        }
        if (adminSubcommand === 'changewithdrawlimit') {
            const receiver = interaction.options.getUser('player');
            const addAmount = interaction.options.getInteger('add');
            const subtractAmount = interaction.options.getInteger('subtract');
            const resetAmount = interaction.options.getInteger('reset');

            // Validate that exactly one option is provided
            const optionsProvided = [addAmount, subtractAmount, resetAmount].filter(opt => opt !== null).length;

            if (optionsProvided === 0) {
                return await interaction.editReply('❌ You must provide one of: `add`, `subtract`, or `reset`.');
            }

            if (optionsProvided > 1) {
                return await interaction.editReply('❌ You can only use one option at a time: `add`, `subtract`, or `reset`.');
            }

            try {
                let profileData = await profileModel.findOne({ userId: receiver.id });
                if (!profileData) {
                    profileData = await profileModel.create({
                        userId: receiver.id,
                        serverID: interaction.guild?.id ?? null
                    });
                }

                // Initialize customWithdrawLimit if it doesn't exist
                if (typeof profileData.customWithdrawLimit === 'undefined') {
                    profileData.customWithdrawLimit = 0;
                }

                const previousCustomLimit = profileData.customWithdrawLimit;
                const previousTotalLimit = globalValues.maxWithdrawPerWeek + previousCustomLimit;
                let newCustomLimit = previousCustomLimit;
                let operation = '';

                if (addAmount !== null) {
                    newCustomLimit += addAmount;
                    operation = `added ${addAmount.toLocaleString()} points`;
                } else if (subtractAmount !== null) {
                    newCustomLimit -= subtractAmount;
                    operation = `subtracted ${subtractAmount.toLocaleString()} points`;
                } else if (resetAmount !== null) {
                    newCustomLimit = resetAmount;
                    operation = resetAmount === 0 ? 'reset to default' : `set to ${resetAmount.toLocaleString()} points`;
                }

                profileData.customWithdrawLimit = newCustomLimit;
                await profileData.save();

                const newTotalLimit = globalValues.maxWithdrawPerWeek + newCustomLimit;
                const remainingThisWeek = newTotalLimit - profileData.weeklyWithdrawAmount;
                const resetTimestamp = profileData.firstWithdrawAt === 0
                    ? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
                    : Math.floor(profileData.firstWithdrawAt / 1000) + 7 * 24 * 60 * 60;

                const embed = new EmbedBuilder()
                    .setTitle(`✅ ${receiver.username}'s Withdraw Limit Modified`)
                    .setColor(0x2ECC71)
                    .setDescription(`Successfully ${operation} to ${receiver.username}'s weekly withdraw limit.`)
                    .addFields(
                        {
                            name: 'Base Limit',
                            value: `${globalValues.maxWithdrawPerWeek.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Custom Bonus',
                            value: `${previousCustomLimit.toLocaleString()} → ${newCustomLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: '\u200B',
                            value: '\u200B',
                            inline: true
                        },
                        {
                            name: 'Total Limit',
                            value: `${previousTotalLimit.toLocaleString()} → ${newTotalLimit.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Remaining This Week',
                            value: `${remainingThisWeek.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Withdrawn This Week',
                            value: `${profileData.weeklyWithdrawAmount.toLocaleString()} points`,
                            inline: true
                        },
                        {
                            name: 'Week Resets',
                            value: `<t:${resetTimestamp}:R>`,
                            inline: false
                        }
                    )
                    .setFooter({ text: receiver.username, iconURL: receiver.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });

                await notifyOwner(
                    'changewithdrawlimit',
                    `Modified ${receiver.tag}'s (${receiver.id}) withdraw limit: ${operation}. New custom bonus: ${newCustomLimit.toLocaleString()} points (total limit: ${newTotalLimit.toLocaleString()} points)`
                );

            } catch (error) {
                console.error('Error changing withdraw limit:', error);
                await interaction.editReply('An error occurred while changing the withdraw limit. Please try again.');
            }
        }
    },
};

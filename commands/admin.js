const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const profileModel = require('../models/profileSchema');
const globalValues = require('../globalValues.json');
const taskManager = require('../utils/taskManager');
const withdrawUtil = require('../utils/withdrawUtil');
const { updateBalance, setBalance } = require('../utils/dbUtils');
const transferModel = require('../models/transferSchema');
const loanModel = require('../models/loanSchema');
const WITHDRAWAL_LOGS_CHANNEL_ID = process.env.WITHDRAWAL_LOGS_CHANNEL_ID;

// Generate task choices from globalValues
const taskChoices = Object.values(globalValues.taskInfo).map(task => ({
    name: task.taskName,
    value: task.taskName
}));

// Generate job choices from globalValues, only include jobs that have jobName defined
const jobChoices = globalValues.paidRoleInfo
    .filter(job => job.jobName) // Filter out entries without jobName
    .map(job => ({
        name: job.jobName,
        value: job.jobName
    }));

const jobRoleIds = globalValues.paidRoleInfo
    .filter(job => job.jobName) // Filter out entries without jobName
    .map(job => ({
        name: job.roleId,
        value: job.roleId
    }));

// Your user ID - replace with your actual Discord user ID
const OWNER_USER_ID = '984131525715054653'; //owner's user ID to dm

const OWNER_ROLE_ID = '1434170522341736448'; //notifies all members who have this role when an admin command is used, optional

const ADMIN_ROLE_ID = globalValues.adminRoleId; // Admin role ID from global values

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Access to all the admin commands')

        //give users with admin role permission to view and use this command
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

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
                        .setMinValue(0)))

        .addSubcommand((subcommand) =>
            subcommand
                .setName('paytransfer')
                .setDescription('Mark a pending transfer as paid and schedule deletion')
                .addStringOption((option) =>
                    option
                        .setName('transferid')
                        .setDescription('The transfer ID to mark as paid')
                        .setRequired(true)))

        .addSubcommand(subcommand =>
            subcommand
                .setName('endgame')
                .setDescription('Force end an active game')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Game type')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Tic Tac Toe', value: 'tictactoe' },
                            { name: 'Connect 4', value: 'connect4' },
                            { name: 'Rock Paper Scissors', value: 'rps' }
                        ))
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('One of the players in the game')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('outcome')
                        .setDescription('How to resolve the game')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Refund Both Players', value: 'refund' },
                            { name: 'Award to Player 1', value: 'player1' },
                            { name: 'Award to Player 2', value: 'player2' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('activegames')
                .setDescription('View all active games')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Filter by game type (optional)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Games', value: 'all' },
                            { name: 'Tic Tac Toe', value: 'tictactoe' },
                            { name: 'Connect 4', value: 'connect4' },
                            { name: 'Rock Paper Scissors', value: 'rps' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('gameinfo')
                .setDescription('Get detailed info about a specific game')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Game type')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Tic Tac Toe', value: 'tictactoe' },
                            { name: 'Connect 4', value: 'connect4' },
                            { name: 'Rock Paper Scissors', value: 'rps' }
                        ))
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('One of the players in the game')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('deleteloan')
                .setDescription('Delete a loan by its ID')
                .addStringOption((option) =>
                    option
                        .setName('loanid')
                        .setDescription('The loan ID to delete')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('givejob')
                .setDescription('Give a job to a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to give the job to')
                        .setRequired(true))
                .addStringOption((option) =>
                    option
                        .setName('jobname')
                        .setDescription('The job to give')
                        .setRequired(true)
                        .addChoices(...jobChoices)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('removejob')
                .setDescription('Remove a job from a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to remove the job from')
                        .setRequired(true))
                .addStringOption((option) =>
                    option
                        .setName('jobname')
                        .setDescription('The job to remove')
                        .setRequired(true)
                        .addChoices(...jobChoices)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('warn')
                .setDescription('Issue a warning to a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to warn')
                        .setRequired(true))
                .addStringOption((option) =>
                    option
                        .setName('reason')
                        .setDescription('The reason for the warning')
                        .setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('clearwarn')
                .setDescription('Remove a warning from a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to remove the warning from')
                        .setRequired(true))
                .addIntegerOption((option) =>
                    option
                        .setName('amount')
                        .setDescription('The number of warnings to remove')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand((subcommand) =>
            subcommand
                .setName('viewwarns')
                .setDescription('View warnings for a player')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('The player to view warnings for')
                        .setRequired(false))),

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
                //return so if owner also has owner role, he doesnt get double notified
                return;
            }
            //notify all members with owner role too
            if (OWNER_ROLE_ID) {
                try {
                    const guild = interaction.guild;
                    const ownerRole = await guild.roles.fetch(OWNER_ROLE_ID);
                    if (ownerRole) {
                        const membersWithRole = ownerRole.members;
                        membersWithRole.forEach(async (member) => {
                            //also check if the member is not the interaction user to prevent self dm
                            if (member.id === interaction.user.id) return;
                            try {
                                await member.send(
                                    `🚨 **Admin Command Used**\n\n` +
                                    `**User:** ${interaction.user.tag} (${interaction.user.id})\n` +
                                    `**Server:** ${interaction.guild?.name || 'Unknown'}\n` +
                                    `**Command:** /admin ${commandName}\n` +
                                    `**Details:** ${details}`
                                );
                            } catch (error) {
                                console.error('Failed to send DM notification to member with owner role:', error);
                            }
                        });
                    }
                } catch (error) {
                    console.error('Failed to fetch owner role or members:', error);
                }
            }
        }

        // function to check if user has permission to run specific subcommand
        async function hasPermission(user, subcommand) {
            if (user.id === OWNER_USER_ID) {
                return true; // Owner has all permissions
            }
            //if  user has owner role, he has access to all subcommands
            if (OWNER_ROLE_ID) {
                const member = await interaction.guild.members.fetch(user.id);
                if (member.roles.cache.has(OWNER_ROLE_ID)) {
                    return true;
                }
            }
            console.log("Checking permissions for user:", user.tag, "on subcommand:", subcommand);
            const member = await interaction.guild.members.fetch(user.id);
            //if member has admin role, he gains access to givetask subcommand only
            if (member.roles.cache.has(ADMIN_ROLE_ID)) {
                //console.log(`User ${user.tag} has admin role.`);n
                if (subcommand === 'givetask') {
                    console.log(`User ${user.tag} has admin role and is allowed to run givetask subcommand.`);
                    return true;
                }
                //if subcommand is warn, clearwarn or viewwarns, allow too
                if (subcommand === 'warn' || subcommand === 'clearwarn' || subcommand === 'viewwarns') {
                    console.log(`User ${user.tag} has admin role and is allowed to run ${subcommand} subcommand.`);
                    return true;
                }

            }
            if (subcommand === 'givejob' || subcommand === 'removejob') {
                return true
            };
            return false;
        }

        // check if user has permission to run the subcommand, but also take interaction as param, and if user doesnt have permission, reply with error message
        //saying "insufficient permissions to run this command"
        async function checkPermissionOrReply(interaction, subcommand) {
            const hasPerm = await hasPermission(interaction.user, subcommand);

            if (!hasPerm) {
                await interaction.editReply("Insufficient permissions to run this command.");
                return false;
            }
            return true;
        }
        const permissionGranted = await checkPermissionOrReply(interaction, adminSubcommand);
        if (!permissionGranted) {
            return;
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

                //notify owner, tell who gave what task to whom
                //say the interaction user tag, the receiver tag, and the task name
                await notifyOwner('givetask', `Gave task "${taskName}" to ${receiver.tag} (${receiver.id}) by ${interaction.user.tag} (${interaction.user.id})`);



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

        if (adminSubcommand === 'paytransfer') {
            const transferId = interaction.options.getString('transferid').trim();

            try {
                // Find the transfer
                const transfer = await transferModel.findById(transferId);

                if (!transfer) {
                    return await interaction.editReply(`❌ Transfer with ID \`${transferId}\` not found.`);
                }

                if (transfer.status !== 'pending') {
                    return await interaction.editReply(`❌ Transfer \`${transferId}\` is not pending (status: ${transfer.status}).`);
                }

                // Update transfer status to paid
                transfer.status = 'paid';
                transfer.paidAt = new Date();
                transfer.paidBy = interaction.user.id;
                await transfer.save();

                // Check if user has any other pending transfers
                const remainingPendingTransfers = await transferModel.countDocuments({
                    userId: transfer.userId,
                    status: 'pending'
                });

                // Remove pending transfers role from user only if they have no pending transfers left
                try {
                    const member = await interaction.guild.members.fetch(transfer.userId);

                    if (remainingPendingTransfers === 0 && member.roles.cache.has(globalValues.pendingTransfersRoleId)) {
                        await member.roles.remove(globalValues.pendingTransfersRoleId);
                        console.log(`[Admin] Removed pending transfers role from ${member.user.tag} (no pending transfers remaining)`);
                    } else if (remainingPendingTransfers > 0) {
                        console.log(`[Admin] User ${member.user.tag} still has ${remainingPendingTransfers} pending transfer(s), keeping role`);
                    }

                    // Notify user via DM
                    try {
                        await member.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle('✅ Transfer Completed!')
                                    .setColor(0x2ECC71)
                                    .setDescription('Your transfer has been processed and paid.')
                                    .addFields(
                                        { name: 'Items', value: transfer.transferDescription, inline: false },
                                        { name: 'Points Spent', value: `${transfer.pointsPaid.toLocaleString()} points`, inline: true },
                                        { name: 'Transfer ID', value: `\`${transfer._id}\``, inline: true }
                                    )
                                    .setFooter({ text: 'Thank you for using our transfer system!' })
                                    .setTimestamp()
                            ]
                        });
                    } catch (dmError) {
                        console.log(`Could not send DM to user ${transfer.userId}:`, dmError.message);
                    }
                } catch (memberError) {
                    console.error('Failed to check/remove pending transfers role:', memberError);
                }

                // Schedule deletion after 24 hours
                setTimeout(async () => {
                    try {
                        await transferModel.findByIdAndDelete(transferId);
                        console.log(`[Admin] Auto-deleted paid transfer ${transferId} after 24 hours`);
                    } catch (deleteError) {
                        console.error(`[Admin] Failed to auto-delete transfer ${transferId}:`, deleteError);
                    }
                }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds

                // Log to withdrawal logs channel
                const logsChannel = interaction.guild.channels.cache.get(WITHDRAWAL_LOGS_CHANNEL_ID);
                if (logsChannel) {
                    // Convert createdAt to timestamp safely
                    const createdTimestamp = transfer.createdAt instanceof Date
                        ? Math.floor(transfer.createdAt.getTime() / 1000)
                        : Math.floor(new Date(transfer.createdAt).getTime() / 1000);

                    const paidTimestamp = Math.floor(transfer.paidAt.getTime() / 1000);

                    const logEmbed = new EmbedBuilder()
                        .setTitle('💰 Transfer Paid')
                        .setColor(0x2ECC71)
                        .setDescription('A pending transfer has been marked as paid.')
                        .addFields(
                            //{ name: 'Transfer ID', value: `\`${transfer._id}\``, inline: false },
                            { name: 'User', value: `<@${transfer.userId}>`, inline: true },
                            { name: 'Paid By', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Total Points', value: `${transfer.pointsPaid.toLocaleString()} points`, inline: true },
                            { name: 'Created', value: `<t:${createdTimestamp}:R>`, inline: true },
                            { name: 'Paid', value: `<t:${paidTimestamp}:R>`, inline: true },
                            { name: 'Items', value: transfer.transferDescription, inline: false },
                            //{ name: 'Remaining Pending', value: `${remainingPendingTransfers} transfer(s)`, inline: true }
                        )
                        .setFooter({ text: 'Transfer will be auto-deleted in 24 hours' })
                        .setTimestamp();

                    await logsChannel.send({ embeds: [logEmbed] });
                }

                // Send confirmation to admin
                const confirmEmbed = new EmbedBuilder()
                    .setTitle('✅ Transfer Paid Successfully')
                    .setColor(0x2ECC71)
                    .setDescription(`Transfer \`${transferId}\` has been marked as paid and will be deleted in 24 hours.`)
                    .addFields(
                        { name: 'User', value: `<@${transfer.userId}>`, inline: true },
                        { name: 'Items', value: transfer.transferDescription, inline: false },
                        { name: 'Points', value: `${transfer.pointsPaid.toLocaleString()} points`, inline: true },
                        { name: 'Remaining Pending Transfers', value: `${remainingPendingTransfers}`, inline: true },
                        { name: 'Role Status', value: remainingPendingTransfers === 0 ? '✅ Role removed' : '⏳ Role kept (has pending transfers)', inline: true }
                    )
                    .setFooter({ text: 'User has been notified' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [confirmEmbed] });

                await notifyOwner(
                    'paytransfer',
                    `Paid transfer ${transferId} for user ${transfer.userId}. Items: ${transfer.transferDescription}, Points: ${transfer.pointsPaid.toLocaleString()}. Remaining pending: ${remainingPendingTransfers}`
                );

            } catch (error) {
                console.error('Error paying transfer:', error);
                await interaction.editReply('❌ An error occurred while processing the transfer payment. Please try again.');
            }
        }
        if (adminSubcommand === 'deleteloan') {
            const loanId = interaction.options.getString('loanid').trim();

            try {
                const loan = await loanModel.findById(loanId);
                if (!loan) {
                    return await interaction.editReply(`❌ Loan with ID \`${loanId}\` not found.`);
                }

                await loanModel.findByIdAndDelete(loanId);

                await notifyOwner('deleteloan', `Deleted loan ${loanId} by ${interaction.user.tag} (${interaction.user.id}). Lender: ${loan.lenderId}, Borrower: ${loan.borrowerId}, Amount: ${loan.amount}, Payback: ${loan.paybackAmount}`);

                await interaction.editReply(`✅ Loan \`${loanId}\` deleted successfully.`);
            } catch (error) {
                console.error('Error deleting loan:', error);
                await interaction.editReply('❌ An error occurred while deleting the loan. Please try again.');
            }
        }
        if (adminSubcommand === 'givejob') {
            const user = interaction.options.getUser('player');
            const job = interaction.options.getString('jobname');

            try {
                const profile = await profileModel.findOne({
                    userId: user.id,
                    serverID: interaction.guild.id
                });

                if (!profile) {
                    return await interaction.editReply(`❌ User ${user.tag} not found.`);
                }

                //check if job exists in jobchoices
                const jobExists = jobChoices.some(j => j.value === job);
                if (!jobExists) {
                    console.log('Job does not exist in job choices:', job);
                    console.log('Available job choices:', jobChoices.map(j => j.value));
                    return await interaction.editReply(`❌ Job \`${job}\` does not exist.`);
                }

                //get the member of the user and go trough their roles to see if they have the job role already
                const userMember = await interaction.guild.members.fetch(user.id);
                //go trough globalValues.paidRoleInfo to see if any of the roles .jobName matches the job name, and if the user has that role, return error
                for (const roleInfo of Object.values(globalValues.paidRoleInfo)) {
                    if (roleInfo.jobName === job) {
                        if (userMember.roles.cache.has(roleInfo.roleId)) {
                            return await interaction.editReply(`❌ User ${user.tag} already has the job \`${job}\`.`);
                        }
                    }
                }

                //give the job role to the user
                let roleIdToGive = null;
                for (const roleInfo of Object.values(globalValues.paidRoleInfo)) {
                    if (roleInfo.jobName === job) {
                        roleIdToGive = roleInfo.roleId;
                        break;
                    }
                }
                if (!roleIdToGive) {
                    return await interaction.editReply(`❌ Role ID for job \`${job}\` not found.`);
                }
                //check if admin has permission to give this job
                const hasJobPermission = await this.userHasPermissionToJob(interaction, interaction.user, job);
                if (!hasJobPermission) {
                    return await interaction.editReply(`❌ You do not have permission to give the job \`${job}\`.`);
                }

                //check if user already owns >= globalValues.maxJobsPerUser jobs
                let userJobCount = 0;
                for (const roleInfo of Object.values(globalValues.paidRoleInfo)) {
                    //also make sure its a job that exists in jobChoices
                    const jobExistsInChoices = jobChoices.some(j => j.value === roleInfo.jobName);
                    if (jobExistsInChoices && userMember.roles.cache.has(roleInfo.roleId)) {
                        userJobCount += 1;
                    }
                }
                if (userJobCount >= globalValues.maxJobsPerUser) {
                    return await interaction.editReply(`❌ User ${user.tag} already has the maximum number of jobs (${globalValues.maxJobsPerUser}).`);
                }

                await userMember.roles.add(roleIdToGive);

                await notifyOwner('givejob', `Gave job ${job} to user ${user.tag} (${user.id})`);

                await interaction.editReply(`✅ Job \`${job}\` given to user ${user.tag}.`);
            } catch (error) {
                console.error('Error giving job:', error);
                await interaction.editReply('❌ An error occurred while giving the job. Please try again.');
            }
        }
        if (adminSubcommand === 'removejob') {
            const user = interaction.options.getUser('player');
            const job = interaction.options.getString('jobname');
            try {
                const profile = await profileModel.findOne({
                    userId: user.id,
                    serverID: interaction.guild.id
                });
                if (!profile) {
                    return await interaction.editReply(`❌ User ${user.tag} not found.`);
                }
                //check if job exists in jobchoices
                const jobExists = jobChoices.some(j => j.value === job);
                if (!jobExists) {
                    return await interaction.editReply(`❌ Job \`${job}\` does not exist.`);
                }

                //get the member of the user and go trough their roles to see if they have the job role
                const userMember = await interaction.guild.members.fetch(user.id);
                //go trough globalValues.paidRoleInfo to see if any of the roles .jobName matches the job name, and if the user has that role, remove it
                let roleIdToRemove = null;
                for (const roleInfo of Object.values(globalValues.paidRoleInfo)) {
                    if (roleInfo.jobName === job) {
                        if (!userMember.roles.cache.has(roleInfo.roleId)) {
                            return await interaction.editReply(`❌ User ${user.tag} does not have the job \`${job}\`.`);
                        }
                        roleIdToRemove = roleInfo.roleId;
                        break;
                    }
                }
                if (!roleIdToRemove) {
                    return await interaction.editReply(`❌ Role ID for job \`${job}\` not found.`);
                }

                //check if admin has permission to remove this job
                const hasJobPermission = await this.userHasPermissionToJob(interaction, interaction.user, job);
                if (!hasJobPermission) {
                    return await interaction.editReply(`❌ You do not have permission to remove the job \`${job}\`.`);
                }
                await userMember.roles.remove(roleIdToRemove);

                await notifyOwner('removejob', `Removed job ${job} from user ${user.tag} (${user.id})`);
                await interaction.editReply(`✅ Job \`${job}\` removed from user ${user.tag}.`);
            } catch (error) {
                console.error('Error removing job:', error);
                await interaction.editReply('❌ An error occurred while removing the job. Please try again.');
            }
        }
        if (adminSubcommand === 'viewwarns') {
            const user = interaction.options.getUser('player');
            try {
                const profile = await profileModel.findOne({
                    userId: user.id,
                    serverID: interaction.guild.id
                });
                if (!profile) {
                    return await interaction.editReply(`❌ User ${user.tag} not found.`);
                }
                const warnings = profile.warnings || [];
                if (warnings.length === 0) {
                    return await interaction.editReply(`❌ User ${user.tag} has no warnings.`);
                }
                let warningList = '';
                for (let i = 0; i < warnings.length; i++) {
                    warningList += `${i + 1}. ${warnings[i].reason} (by ${warnings[i].issuedBy})\n`;
                }
                await interaction.editReply(`⚠️ Warnings for user ${user.tag}:\n${warningList}`);
            } catch (error) {
                console.error('Error viewing warnings:', error);
                await interaction.editReply('❌ An error occurred while viewing warnings. Please try again.');
            }
        }
        if (adminSubcommand === 'clearwarn') {
            const user = interaction.options.getUser('player');
            const amount = interaction.options.getInteger('amount');
            try {
                const profile = await profileModel.findOne({
                    userId: user.id,
                    serverID: interaction.guild.id
                });
                if (!profile) {
                    return await interaction.editReply(`❌ User ${user.tag} not found.`);
                }
                const warnings = profile.warnings || [];
                if (warnings.length === 0) {
                    return await interaction.editReply(`❌ User ${user.tag} has no warnings to clear.`);
                }
                const warningsToClear = Math.min(amount, warnings.length);
                profile.warnings = warnings.slice(0, warnings.length - warningsToClear);
                await profile.save();

            } catch (error) {
                console.error('Error clearing warnings:', error);
                await interaction.editReply('❌ An error occurred while clearing warnings. Please try again.');
            }
        }
        if (adminSubcommand === 'warn') {
            const user = interaction.options.getUser('player');
            const reason = interaction.options.getString('reason');
            try {
                const profile = await profileModel.findOne({
                    userId: user.id,
                    serverID: interaction.guild.id
                });
                if (!profile) {
                    return await interaction.editReply(`❌ User ${user.tag} not found.`);
                }
                if (!profile.warnings) {
                    profile.warnings = [];
                }
                profile.warnings.push({
                    reason: reason,
                    issuedAt: Date.now(),
                    issuedBy: interaction.user.tag
                });
                await profile.save();
                await interaction.editReply(`✅ Warning added to user ${user.tag}.`);
            } catch (error) {
                console.error('Error issuing warning:', error);
                await interaction.editReply('❌ An error occurred while issuing the warning. Please try again.');
            }
        }

        if (adminSubcommand === 'endgame') {
            return await this.endGame(interaction, notifyOwner);
        }

        if (adminSubcommand === 'activegames') {
            return await this.activeGames(interaction);
        }

        if (adminSubcommand === 'gameinfo') {
            return await this.gameInfo(interaction);
        }

    }, //END OF EXECUTE



    async userHasPermissionToJob(interaction, user, job) {
        const member = await interaction.guild.members.fetch(user.id);

        //if user has owner role, he has access to all subcommands
        if (OWNER_ROLE_ID) {
            if (member.roles.cache.has(OWNER_ROLE_ID)) {
                return true;
            }
        }

        //if users id is 1087129975347486920, and the job name is "Pet Lover", return true
        if (user.id === '1087129975347486920' && job === 'Pet Lover') {
            console.log(`User ${user.tag} is the special admin and has permission for job ${job}.`);
            return true;
        }
        //const jobDef = globalValues.jobInfo[job];
        //if (!jobDef) {
        //  console.warn(`Job definition for ${job} not found.`);
        //   return false;
        //}
        //if (jobDef.adminOnly) {
        //    return member.permissions.has(PermissionsBitField.Flags.Administrator);
        // }
        return false;
    },



    async endGame(interaction, notifyOwner) {
        const gameType = interaction.options.getString('type');
        const player = interaction.options.getUser('player');
        const outcome = interaction.options.getString('outcome');

        let gamesMap;
        let gameName;

        if (gameType === 'tictactoe') {
            gamesMap = global.activeTTTGames;
            gameName = 'Tic Tac Toe';
        } else if (gameType === 'connect4') {
            gamesMap = global.activeC4Games;
            gameName = 'Connect 4';
        } else if (gameType === 'rps') {
            const { activeRPSGames } = require('../events/interactionCreate');
            gamesMap = activeRPSGames;
            gameName = 'Rock Paper Scissors';
        }

        if (!gamesMap || gamesMap.size === 0) {
            return await interaction.editReply(`❌ No active ${gameName} games found.`);
        }

        let foundGameId = null;
        let foundGame = null;

        for (const [gameId, game] of gamesMap.entries()) {
            if (game.challengerId === player.id || game.opponentId === player.id) {
                foundGameId = gameId;
                foundGame = game;
                break;
            }
        }

        if (!foundGame) {
            return await interaction.editReply(`❌ No active ${gameName} game found for ${player.tag}.`);
        }

        const { challengerId, opponentId, betAmount } = foundGame;

        if (outcome === 'refund') {
            const challengerProfile = await profileModel.findOne({
                userId: challengerId,
                serverID: interaction.guild.id
            });
            const opponentProfile = await profileModel.findOne({
                userId: opponentId,
                serverID: interaction.guild.id
            });

            if (challengerProfile) {
                challengerProfile.balance += betAmount;
                await challengerProfile.save();
            }

            if (opponentProfile) {
                opponentProfile.balance += betAmount;
                await opponentProfile.save();
            }

            try {
                const balanceChangeEvent = require('../events/balanceChange');
                const challengerMember = await interaction.guild.members.fetch(challengerId);
                const opponentMember = await interaction.guild.members.fetch(opponentId);
                balanceChangeEvent.execute(challengerMember);
                balanceChangeEvent.execute(opponentMember);
            } catch (err) {
                console.error('Failed to trigger balance change event:', err);
            }

            await interaction.editReply(`✅ ${gameName} game ended by admin. ${betAmount.toLocaleString()} points refunded to both <@${challengerId}> and <@${opponentId}>.`);

        } else {
            const winnerId = outcome === 'player1' ? challengerId : opponentId;
            const winnerProfile = await profileModel.findOne({
                userId: winnerId,
                serverID: interaction.guild.id
            });

            if (winnerProfile) {
                winnerProfile.balance += betAmount * 2;
                await winnerProfile.save();

                try {
                    const balanceChangeEvent = require('../events/balanceChange');
                    const winnerMember = await interaction.guild.members.fetch(winnerId);
                    balanceChangeEvent.execute(winnerMember);
                } catch (err) {
                    console.error('Failed to trigger balance change event:', err);
                }
            }

            await interaction.editReply(`✅ ${gameName} game ended by admin. <@${winnerId}> awarded ${(betAmount * 2).toLocaleString()} points.`);
        }

        gamesMap.delete(foundGameId);

        const gamesLogsChannel = interaction.guild.channels.cache.get(process.env.GAMES_LOGS_CHANNEL_ID);
        if (gamesLogsChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`🛑 ${gameName} - Admin Intervention`)
                .addFields(
                    { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Player 1', value: `<@${challengerId}>`, inline: true },
                    { name: 'Player 2', value: `<@${opponentId}>`, inline: true },
                    { name: 'Outcome', value: outcome === 'refund' ? 'Refunded both' : `Awarded to <@${outcome === 'player1' ? challengerId : opponentId}>`, inline: false },
                    { name: 'Amount', value: outcome === 'refund' ? `${betAmount.toLocaleString()} each` : `${(betAmount * 2).toLocaleString()} total`, inline: true }
                )
                .setColor(0xE74C3C)
                .setTimestamp();

            await gamesLogsChannel.send({ embeds: [logEmbed] });
        }

        await notifyOwner(
            'endgame',
            `Ended ${gameName} game for ${player.tag}. Outcome: ${outcome}. Amount: ${outcome === 'refund' ? betAmount : betAmount * 2} points`
        );
    },

    async activeGames(interaction) {
        const filterType = interaction.options.getString('type') || 'all';

        const embed = new EmbedBuilder()
            .setTitle('🎮 Active Games')
            .setColor(0x3498DB)
            .setTimestamp();

        let totalGames = 0;
        let description = '';

        if (filterType === 'all' || filterType === 'tictactoe') {
            const tttGames = global.activeTTTGames || new Map();
            if (tttGames.size > 0) {
                description += `\n**⭕ Tic Tac Toe (${tttGames.size})**\n`;
                for (const [gameId, game] of tttGames.entries()) {
                    const challenger = await interaction.client.users.fetch(game.challengerId).catch(() => null);
                    const opponent = await interaction.client.users.fetch(game.opponentId).catch(() => null);

                    description += `• ${challenger?.username || 'Unknown'} vs ${opponent?.username || 'Unknown'}\n`;
                    description += `  Bet: ${game.betAmount.toLocaleString()} points | Turn: <@${game.currentTurn}>\n`;
                }
                totalGames += tttGames.size;
            }
        }

        if (filterType === 'all' || filterType === 'connect4') {
            const c4Games = global.activeC4Games || new Map();
            if (c4Games.size > 0) {
                description += `\n**🔴 Connect 4 (${c4Games.size})**\n`;
                for (const [gameId, game] of c4Games.entries()) {
                    const challenger = await interaction.client.users.fetch(game.challengerId).catch(() => null);
                    const opponent = await interaction.client.users.fetch(game.opponentId).catch(() => null);

                    description += `• ${challenger?.username || 'Unknown'} vs ${opponent?.username || 'Unknown'}\n`;
                    description += `  Bet: ${game.betAmount.toLocaleString()} points | Turn: <@${game.currentTurn}>\n`;
                }
                totalGames += c4Games.size;
            }
        }

        if (filterType === 'all' || filterType === 'rps') {
            const { activeRPSGames } = require('../events/interactionCreate');
            const rpsGames = activeRPSGames || new Map();

            if (rpsGames.size > 0) {
                description += `\n**🪨📄✂️ Rock Paper Scissors (${rpsGames.size})**\n`;
                for (const [gameId, game] of rpsGames.entries()) {
                    const challenger = await interaction.client.users.fetch(game.challengerId).catch(() => null);
                    const opponent = await interaction.client.users.fetch(game.opponentId).catch(() => null);

                    const challengerReady = game.choices[game.challengerId] ? '✅' : '⏳';
                    const opponentReady = game.choices[game.opponentId] ? '✅' : '⏳';

                    description += `• ${challenger?.username || 'Unknown'} ${challengerReady} vs ${opponent?.username || 'Unknown'} ${opponentReady}\n`;
                    description += `  Bet: ${game.betAmount.toLocaleString()} points\n`;
                }
                totalGames += rpsGames.size;
            }
        }

        if (totalGames === 0) {
            description = '📭 No active games found.';
        } else {
            description = `**Total Active Games: ${totalGames}**\n${description}`;
        }

        embed.setDescription(description);

        await interaction.editReply({ embeds: [embed] });
    },

    async gameInfo(interaction) {
        const gameType = interaction.options.getString('type');
        const player = interaction.options.getUser('player');

        let gamesMap;
        let gameName;

        if (gameType === 'tictactoe') {
            gamesMap = global.activeTTTGames;
            gameName = 'Tic Tac Toe';
        } else if (gameType === 'connect4') {
            gamesMap = global.activeC4Games;
            gameName = 'Connect 4';
        } else if (gameType === 'rps') {
            const { activeRPSGames } = require('../events/interactionCreate');
            gamesMap = activeRPSGames;
            gameName = 'Rock Paper Scissors';
        }

        if (!gamesMap || gamesMap.size === 0) {
            return await interaction.editReply(`❌ No active ${gameName} games found.`);
        }

        let foundGame = null;
        let foundGameId = null;

        for (const [gameId, game] of gamesMap.entries()) {
            if (game.challengerId === player.id || game.opponentId === player.id) {
                foundGame = game;
                foundGameId = gameId;
                break;
            }
        }

        if (!foundGame) {
            return await interaction.editReply(`❌ No active ${gameName} game found for ${player.tag}.`);
        }

        const challenger = await interaction.client.users.fetch(foundGame.challengerId);
        const opponent = await interaction.client.users.fetch(foundGame.opponentId);

        const embed = new EmbedBuilder()
            .setTitle(`🎮 ${gameName} Game Info`)
            .setColor(0x3498DB)
            .addFields(
                { name: 'Game ID', value: foundGameId, inline: false },
                { name: 'Player 1 (Challenger)', value: `${challenger.tag} (<@${foundGame.challengerId}>)`, inline: true },
                { name: 'Player 2 (Opponent)', value: `${opponent.tag} (<@${foundGame.opponentId}>)`, inline: true },
                { name: 'Bet Amount', value: `${foundGame.betAmount.toLocaleString()} points each`, inline: true },
                { name: 'Prize Pool', value: `${(foundGame.betAmount * 2).toLocaleString()} points`, inline: true },
                { name: 'Current Turn', value: `<@${foundGame.currentTurn}>`, inline: true },
                { name: 'Message ID', value: foundGame.messageId || 'N/A', inline: true }
            )
            .setTimestamp();

        if (gameType === 'tictactoe') {
            const xPlayer = foundGame.xPlayer === foundGame.challengerId ? challenger.tag : opponent.tag;
            const oPlayer = foundGame.oPlayer === foundGame.challengerId ? challenger.tag : opponent.tag;

            embed.addFields(
                { name: 'X Player', value: xPlayer, inline: true },
                { name: 'O Player', value: oPlayer, inline: true }
            );

            const emojis = { '': '⬜', 'X': '❌', 'O': '⭕' };
            let boardDisplay = '';
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    const index = row * 3 + col;
                    boardDisplay += emojis[foundGame.board[index] || ''];
                }
                boardDisplay += '\n';
            }
            embed.addFields({ name: 'Board State', value: boardDisplay, inline: false });

        } else if (gameType === 'connect4') {
            const redPlayer = foundGame.redPlayer === foundGame.challengerId ? challenger.tag : opponent.tag;
            const yellowPlayer = foundGame.yellowPlayer === foundGame.challengerId ? challenger.tag : opponent.tag;

            embed.addFields(
                { name: '🔴 Red Player', value: redPlayer, inline: true },
                { name: '🟡 Yellow Player', value: yellowPlayer, inline: true }
            );

            let filledCells = 0;
            for (const row of foundGame.board) {
                filledCells += row.filter(cell => cell !== '').length;
            }
            embed.addFields({ name: 'Filled Cells', value: `${filledCells}/42`, inline: true });

        } else if (gameType === 'rps') {
            const challengerReady = foundGame.choices[foundGame.challengerId] ? '✅ Ready' : '⏳ Waiting';
            const opponentReady = foundGame.choices[foundGame.opponentId] ? '✅ Ready' : '⏳ Waiting';

            embed.addFields(
                { name: 'Player 1 Status', value: challengerReady, inline: true },
                { name: 'Player 2 Status', value: opponentReady, inline: true }
            );
        }

        await interaction.editReply({ embeds: [embed] });
    }

};
const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { paidRoleInfo, messagesNeededForTrivia, triviaMinCooldownInMinutes, triviaMaxCooldownInMinutes } = require('../globalValues.json');
const { updateBalance } = require('../utils/dbUtils');

// Map userId -> { channelId, timestamp }
if (!global.userLastMessageChannel) {
    global.userLastMessageChannel = new Map();
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) {
            return;
        }

        const profileModel = require('../models/profileSchema');
        const profileData = await profileModel.findOne({ userId: message.author.id, serverID: message.guild.id });

        if (!profileData) {
            return; // Profile will be created on first command interaction
        }

        const now = Date.now();

        // ===== DAILY ROLE PAY =====
        const lastPay = profileData.lastDailyRolePay || 0;
        if (now - lastPay >= 86400000) { // 24 hours
            let totalPay = 0;
            const rolesPaidFor = [];

            for (const rolePay of paidRoleInfo) {
                const roleId = rolePay.roleId;
                const pointReward = rolePay.pointReward || 0;

                if (message.member.roles.cache.has(roleId)) {
                    totalPay += pointReward;
                    const role = message.guild.roles.cache.get(roleId);
                    rolesPaidFor.push({ name: role?.name || 'Unknown Role', points: pointReward });
                }
            }

            if (totalPay > 0) {
                // Update lastDailyRolePay timestamp BEFORE awarding points to prevent race condition
                const updateResult = await profileModel.findOneAndUpdate(
                    { userId: message.author.id, serverID: message.guild.id, lastDailyRolePay: { $lt: now - 86400000 } },
                    { $set: { lastDailyRolePay: now } },
                    { new: true }
                );

                if (!updateResult) {
                    // Payment was already processed in another request, skip
                    console.log(`Daily role pay already processed for userId: ${message.author.id}`);
                    return;
                }

                // Award points using the utility function
                const balanceUpdateResult = await updateBalance(
                    message.author.id,
                    totalPay,
                    { client: message.client },
                    { serverId: message.guild?.id ?? null }
                );

                if (!balanceUpdateResult.success) {
                    console.error(`Failed to award daily role pay to ${message.author.id}:`, balanceUpdateResult.reason);
                } else {
                    const rolesList = rolesPaidFor.map(r => `@${r.name} (${r.points} points)`).join('\n');
                    await message.channel.send(`<@${message.author.id}>, you have received **${totalPay}** daily points from your roles:\n${rolesList}`);
                }
            }
        }

        // ===== TRIVIA SYSTEM =====
        // Check if user already has an active trivia first
        const triviaCache = global.activeTriviaQuestions || new Map();
        const hasActiveTrivia = Array.from(triviaCache.keys()).some(key => key.startsWith(`${message.author.id}_`));

        if (hasActiveTrivia) {
            // User already has an active trivia, don't increment counter or trigger new trivia
            return;
        }

        const currentMessages = profileData.messagesSinceLastTrivia || 0;
        const nextTriviaAvailableAt = profileData.nextTriviaAvailableAt || 0;
        const newMessageCount = currentMessages + 1;

        // Check if trivia should be triggered
        const isCooldownExpired = now >= nextTriviaAvailableAt;
        const hasEnoughMessages = newMessageCount >= messagesNeededForTrivia;

        if (isCooldownExpired && hasEnoughMessages) {
            try {
                // Get trivia question
                const triviaManager = require('../utils/triviaManager');
                const triviaQuestion = triviaManager.getRandomTriviaQuestion();

                // Create embed
                const embed = new EmbedBuilder()
                    .setTitle('🎯 Trivia Time!')
                    .setDescription(`# ${triviaQuestion.question}`)
                    .setColor(0x00AE86)
                    .setFooter({
                        text: `${triviaQuestion.category} • ${triviaQuestion.difficulty} • ${triviaQuestion.rewardPoints} points`
                    })
                    .setTimestamp();

                // Create buttons with option text
                const row = new ActionRowBuilder();
                for (const option of triviaQuestion.options) {
                    const button = new ButtonBuilder()
                        .setCustomId(`trivia_answer_${message.author.id}_${option.id}`)
                        .setLabel(option.text)
                        .setStyle(ButtonStyle.Primary);
                    row.addComponents(button);
                }

                // Send trivia message
                const triviaMessage = await message.channel.send({
                    content: `<@${message.author.id}>, it's trivia time! 🎮`,
                    embeds: [embed],
                    components: [row]
                });

                // Store trivia data for button handler
                global.activeTriviaQuestions = triviaCache;

                triviaCache.set(`${message.author.id}_${triviaMessage.id}`, {
                    correctAnswer: triviaQuestion.correctAnswer,
                    explanation: triviaQuestion.explanation,
                    rewardPoints: triviaQuestion.rewardPoints,
                    userId: message.author.id,
                    guildId: message.guild.id,
                    messageId: triviaMessage.id,
                    expiresAt: now + 180000 // 3 minutes
                });

                // Clean up after 3 minutes
                setTimeout(() => {
                    const data = triviaCache.get(`${message.author.id}_${triviaMessage.id}`);
                    if (data) {
                        triviaCache.delete(`${message.author.id}_${triviaMessage.id}`);

                        // Disable buttons instead of removing
                        triviaMessage.fetch().then(msg => {
                            if (msg.components[0]) {
                                const disabledRow = new ActionRowBuilder();
                                for (const component of msg.components[0].components) {
                                    const disabledButton = ButtonBuilder.from(component)
                                        .setDisabled(true);
                                    disabledRow.addComponents(disabledButton);
                                }
                                msg.edit({ components: [disabledRow] });
                            }
                        }).catch(err => console.log('Could not update expired trivia message'));

                        // Send expiration message
                        message.channel.send({
                            content: `<@${message.author.id}>, time's up! ⏰`,
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle('⏰ Trivia Expired')
                                    .setDescription(`The correct answer was **${triviaQuestion.correctAnswer}**.\n\n${triviaQuestion.explanation}`)
                                    .setColor(0xFF6B6B)
                            ]
                        }).catch(err => console.log('Could not send expiration message'));
                    }
                }, 180000); // 3 minutes

                // Calculate next trivia availability (random between min and max minutes)
                const cooldownMinutes = Math.floor(
                    Math.random() * (triviaMaxCooldownInMinutes - triviaMinCooldownInMinutes + 1)
                ) + triviaMinCooldownInMinutes;
                const nextAvailable = now + (cooldownMinutes * 60000);

                // Reset message counter and set next trivia time
                await profileModel.findOneAndUpdate(
                    { userId: message.author.id, serverID: message.guild.id },
                    {
                        $set: {
                            messagesSinceLastTrivia: 0,
                            nextTriviaAvailableAt: nextAvailable
                        }
                    },
                    { new: true }
                );

                console.log(`[Trivia] Triggered for ${message.author.tag} | Next available in ${cooldownMinutes} minutes`);

            } catch (error) {
                console.error('Error triggering trivia:', error);
                // Still increment message counter even if trivia fails
                await profileModel.findOneAndUpdate(
                    { userId: message.author.id, serverID: message.guild.id },
                    { $set: { messagesSinceLastTrivia: newMessageCount } },
                    { new: true }
                );
            }
        } else {
            // Just increment message counter
            await profileModel.findOneAndUpdate(
                { userId: message.author.id, serverID: message.guild.id },
                { $set: { messagesSinceLastTrivia: newMessageCount } },
                { new: true }
            );
        }

        // Track last message channel
        global.userLastMessageChannel.set(message.author.id, {
            channelId: message.channel.id,
            guildId: message.guild?.id,
            timestamp: Date.now()
        });
    }
};
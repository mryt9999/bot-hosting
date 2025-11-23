const { EmbedBuilder } = require('discord.js');
const lotteryModel = require('../../models/lotterySchema');
const { endNumberLottery, NUMBER_LOTTERY_COST, RAFFLE_LOTTERY_COST } = require('../../utils/lotteryManager');
const dbUtils = require('../../utils/dbUtils');

/**
 * Handles lottery button interactions (number and raffle lotteries)
 */
async function handleLotteryButtons(interaction) {
    const parts = interaction.customId.split('_');
    const lotteryType = parts[1]; // 'number' or 'raffle'
    const lotteryId = parts[2];

    // Get lottery
    let lottery;
    try {
        lottery = await lotteryModel.findById(lotteryId);
    } catch (error) {
        console.error('Invalid lottery ID:', error);
        // Log to thread instead of ephemeral reply
        if (lottery && lottery.logThreadId) {
            try {
                const thread = await interaction.client.channels.fetch(lottery.logThreadId);
                if (thread) {
                    await thread.send({
                        content: `<@${interaction.user.id}> ❌ Invalid lottery ID.`
                    });
                }
            } catch (err) {
                console.error('Failed to log to thread:', err);
            }
        }
        return await interaction.deferUpdate();
    }

    if (!lottery) {
        return await interaction.deferUpdate();
    }

    if (lottery.status === 'ended') {
        // Get lottery thread for logging
        let lotteryThread = null;
        if (lottery.logThreadId) {
            try {
                lotteryThread = await interaction.client.channels.fetch(lottery.logThreadId);
                if (lotteryThread) {
                    await lotteryThread.send({
                        content: `<@${interaction.user.id}> ❌ This lottery has already ended.`
                    });
                }
            } catch (error) {
                console.error('Failed to fetch lottery thread:', error);
            }
        }
        return await interaction.deferUpdate();
    }

    // Get lottery thread for logging
    let lotteryThread = null;
    if (lottery.logThreadId) {
        try {
            lotteryThread = await interaction.client.channels.fetch(lottery.logThreadId);
        } catch (error) {
            console.error('Failed to fetch lottery thread:', error);
        }
    }

    // Get user profile
    const profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild.id);

    if (lotteryType === 'number') {
        // Number lottery - buy a draw
        if (profileData.balance < NUMBER_LOTTERY_COST) {
            const errorMsg = `❌ You need ${NUMBER_LOTTERY_COST.toLocaleString()} points to buy a draw. You have ${profileData.balance.toLocaleString()} points.`;

            // Send to thread only
            if (lotteryThread) {
                await lotteryThread.send({
                    content: `<@${interaction.user.id}> ${errorMsg}`
                });
            }

            return await interaction.deferUpdate();
        }

        // Check if all numbers are used
        if (lottery.usedNumbers.length >= 1000) {
            const errorMsg = '❌ All numbers have been used. This lottery is over.';

            if (lotteryThread) {
                await lotteryThread.send({
                    content: `<@${interaction.user.id}> ${errorMsg}`
                });
            }

            return await interaction.deferUpdate();
        }

        await interaction.deferUpdate();

        // Deduct cost
        profileData.balance -= NUMBER_LOTTERY_COST;
        await profileData.save();

        // Add to prize pool
        lottery.prizePool += NUMBER_LOTTERY_COST;

        // Get available numbers
        const availableNumbers = [];
        for (let i = 1; i <= 1000; i++) {
            if (!lottery.usedNumbers.includes(i)) {
                availableNumbers.push(i);
            }
        }

        // Pick random available number
        const randomNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
        lottery.usedNumbers.push(randomNumber);

        // Add participant
        lottery.participants.push({
            userId: interaction.user.id,
            number: randomNumber,
            joinedAt: Date.now()
        });

        // Check if won
        const isWinner = randomNumber === lottery.winningNumber;

        await lottery.save();

        // Trigger balance change event
        try {
            const balanceChangeEvent = require('../balanceChange');
            balanceChangeEvent.execute(interaction.member);
        } catch (err) {
            console.error('Failed to trigger balance change event:', err);
        }

        if (isWinner) {
            // Winner!
            await endNumberLottery(lottery, interaction.client, interaction.guild, interaction.user.id, randomNumber);
        } else {
            // Update lottery message
            const channel = interaction.guild.channels.cache.get(lottery.channelId);
            if (channel && lottery.messageId) {
                try {
                    const message = await channel.messages.fetch(lottery.messageId);
                    const { createLotteryEmbed } = require('../../utils/lotteryManager');
                    const embed = createLotteryEmbed(lottery);
                    await message.edit({ embeds: [embed] });
                } catch (error) {
                    console.error('Failed to update lottery message:', error);
                }
            }

            // Log to lottery thread
            if (lotteryThread) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🎲 Number Draw Purchase')
                    .setColor(0xE74C3C)
                    .addFields(
                        { name: 'Player', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Number Drawn', value: `${randomNumber}`, inline: true },
                        { name: 'Result', value: '❌ Not a winner', inline: true },
                        { name: 'Prize Pool', value: `${lottery.prizePool.toLocaleString()} points`, inline: true },
                        { name: 'Numbers Used', value: `${lottery.usedNumbers.length}/1000`, inline: true }
                    )
                    .setTimestamp();

                await lotteryThread.send({
                    content: `<@${interaction.user.id}>`,
                    embeds: [logEmbed]
                });
            }
        }
    } else if (lotteryType === 'raffle') {
        // Raffle lottery - enter once
        if (profileData.balance < RAFFLE_LOTTERY_COST) {
            const errorMsg = `❌ You need ${RAFFLE_LOTTERY_COST.toLocaleString()} points to enter the raffle. You have ${profileData.balance.toLocaleString()} points.`;

            if (lotteryThread) {
                await lotteryThread.send({
                    content: `<@${interaction.user.id}> ${errorMsg}`
                });
            }

            return await interaction.deferUpdate();
        }

        // Check if already participated
        const alreadyParticipated = lottery.participants.some(p => p.userId === interaction.user.id);
        if (alreadyParticipated) {
            const errorMsg = '❌ You have already entered this raffle. Only one entry per person.';

            if (lotteryThread) {
                await lotteryThread.send({
                    content: `<@${interaction.user.id}> ${errorMsg}`
                });
            }

            return await interaction.deferUpdate();
        }

        await interaction.deferUpdate();

        // Deduct cost
        profileData.balance -= RAFFLE_LOTTERY_COST;
        await profileData.save();

        // Add to prize pool
        lottery.prizePool += RAFFLE_LOTTERY_COST;

        // Add participant
        lottery.participants.push({
            userId: interaction.user.id,
            joinedAt: Date.now()
        });

        await lottery.save();

        // Trigger balance change event
        try {
            const balanceChangeEvent = require('../balanceChange');
            balanceChangeEvent.execute(interaction.member);
        } catch (err) {
            console.error('Failed to trigger balance change event:', err);
        }

        // Update lottery message
        const channel = interaction.guild.channels.cache.get(lottery.channelId);
        if (channel && lottery.messageId) {
            try {
                const message = await channel.messages.fetch(lottery.messageId);
                const { createLotteryEmbed } = require('../../utils/lotteryManager');
                const embed = createLotteryEmbed(lottery);
                await message.edit({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to update lottery message:', error);
            }
        }

        // Log to lottery thread
        if (lotteryThread) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🎟️ Raffle Entry')
                .setColor(0x3498DB)
                .addFields(
                    { name: 'Player', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Entry Cost', value: `${RAFFLE_LOTTERY_COST.toLocaleString()} points`, inline: true },
                    { name: 'Prize Pool', value: `${lottery.prizePool.toLocaleString()} points`, inline: true },
                    { name: 'Total Participants', value: `${lottery.participants.length}`, inline: true },
                    { name: 'Time Remaining', value: `<t:${Math.floor(lottery.endsAt / 1000)}:R>`, inline: true }
                )
                .setTimestamp();

            await lotteryThread.send({
                content: `<@${interaction.user.id}> ✅ Entered the raffle!`,
                embeds: [logEmbed]
            });
        }
    }
}

module.exports = { handleLotteryButtons };

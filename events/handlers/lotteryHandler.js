const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const lotteryModel = require('../../models/lotterySchema');
const {
    endNumberLottery,
    createLotteryEmbed,
    NUMBER_LOTTERY_COST,
    RAFFLE_LOTTERY_COST,
    ANIMAL_LOTTERY_COST,
    ANIMAL_LOTTERY_ANIMALS
} = require('../../utils/lotteryManager');
const dbUtils = require('../../utils/dbUtils');

/**
 * Handles lottery button interactions (number, raffle, and animal lotteries)
 */
async function handleLotteryButtons(interaction) {
    const parts = interaction.customId.split('_');
    const lotteryType = parts[1]; // 'number', 'raffle', or 'animal'
    const lotteryId = parts[2];

    // Get lottery
    let lottery;
    try {
        lottery = await lotteryModel.findById(lotteryId);
    } catch (error) {
        console.error('Invalid lottery ID:', error);
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
        return await handleNumberLottery(interaction, lottery, profileData, lotteryThread);
    } else if (lotteryType === 'raffle') {
        return await handleRaffleLottery(interaction, lottery, profileData, lotteryThread);
    } else if (lotteryType === 'animal') {
        return await handleAnimalLottery(interaction, lottery, profileData, lotteryThread);
    }
}

/**
 * Handles number lottery interaction
 */
async function handleNumberLottery(interaction, lottery, profileData, lotteryThread) {
    if (profileData.balance < NUMBER_LOTTERY_COST) {
        const errorMsg = `❌ You need ${NUMBER_LOTTERY_COST.toLocaleString()} points to buy a draw. You have ${profileData.balance.toLocaleString()} points.`;

        if (lotteryThread) {
            await lotteryThread.send({
                content: `<@${interaction.user.id}> ${errorMsg}`
            });
        }

        return await interaction.deferUpdate();
    }

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

    profileData.balance -= NUMBER_LOTTERY_COST;
    await profileData.save();

    lottery.prizePool += NUMBER_LOTTERY_COST;

    const availableNumbers = [];
    for (let i = 1; i <= 1000; i++) {
        if (!lottery.usedNumbers.includes(i)) {
            availableNumbers.push(i);
        }
    }

    const randomNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
    lottery.usedNumbers.push(randomNumber);

    lottery.participants.push({
        userId: interaction.user.id,
        number: randomNumber,
        joinedAt: Date.now()
    });

    const isWinner = randomNumber === lottery.winningNumber;

    await lottery.save();

    try {
        const balanceChangeEvent = require('../balanceChange');
        balanceChangeEvent.execute(interaction.member);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    if (isWinner) {
        await endNumberLottery(lottery, interaction.client, interaction.guild, interaction.user.id, randomNumber);
    } else {
        const channel = interaction.guild.channels.cache.get(lottery.channelId);
        if (channel && lottery.messageId) {
            try {
                const message = await channel.messages.fetch(lottery.messageId);
                const embed = createLotteryEmbed(lottery);
                await message.edit({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to update lottery message:', error);
            }
        }

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
}

/**
 * Handles raffle lottery interaction
 */
async function handleRaffleLottery(interaction, lottery, profileData, lotteryThread) {
    if (profileData.balance < RAFFLE_LOTTERY_COST) {
        const errorMsg = `❌ You need ${RAFFLE_LOTTERY_COST.toLocaleString()} points to enter the raffle. You have ${profileData.balance.toLocaleString()} points.`;

        if (lotteryThread) {
            await lotteryThread.send({
                content: `<@${interaction.user.id}> ${errorMsg}`
            });
        }

        return await interaction.deferUpdate();
    }

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

    profileData.balance -= RAFFLE_LOTTERY_COST;
    await profileData.save();

    lottery.prizePool += RAFFLE_LOTTERY_COST;

    lottery.participants.push({
        userId: interaction.user.id,
        joinedAt: Date.now()
    });

    await lottery.save();

    try {
        const balanceChangeEvent = require('../balanceChange');
        balanceChangeEvent.execute(interaction.member);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    const channel = interaction.guild.channels.cache.get(lottery.channelId);
    if (channel && lottery.messageId) {
        try {
            const message = await channel.messages.fetch(lottery.messageId);
            const embed = createLotteryEmbed(lottery);
            await message.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to update lottery message:', error);
        }
    }

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

/**
 * Handles animal lottery interaction - shows animal selection menu
 */
async function handleAnimalLottery(interaction, lottery, profileData, lotteryThread) {
    if (profileData.balance < ANIMAL_LOTTERY_COST) {
        const errorMsg = `❌ You need ${ANIMAL_LOTTERY_COST.toLocaleString()} points to bet. You have ${profileData.balance.toLocaleString()} points.`;

        if (lotteryThread) {
            await lotteryThread.send({
                content: `<@${interaction.user.id}> ${errorMsg}`
            });
        }

        return await interaction.deferUpdate();
    }

    const alreadyBet = lottery.participants.some(p => p.userId === interaction.user.id);
    if (alreadyBet) {
        const existingBet = lottery.participants.find(p => p.userId === interaction.user.id);
        const errorMsg = `❌ You already bet on ${existingBet.animal}! One bet per person.`;

        if (lotteryThread) {
            await lotteryThread.send({
                content: `<@${interaction.user.id}> ${errorMsg}`
            });
        }

        return await interaction.deferUpdate();
    }

    // Create animal selection buttons
    const rows = [];
    const buttonsPerRow = 5;

    // ✅ Use lottery's own availableAnimals instead of global constant
    const animalsToShow = lottery.availableAnimals || ANIMAL_LOTTERY_ANIMALS;

    for (let i = 0; i < animalsToShow.length; i += buttonsPerRow) {
        const rowButtons = [];

        for (let j = i; j < Math.min(i + buttonsPerRow, animalsToShow.length); j++) {
            const animal = animalsToShow[j];
            const betCount = lottery.participants.filter(p => p.animal === animal).length;

            rowButtons.push(
                new ButtonBuilder()
                    .setCustomId(`animal_select_${lottery._id}_${animal}`)
                    .setLabel(`${animal} (${betCount})`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        rows.push(new ActionRowBuilder().addComponents(rowButtons));
    }

    await interaction.reply({
        content: `🏇 **Pick your champion!** (${ANIMAL_LOTTERY_COST} points)\n\nNumbers show how many bets each animal has.`,
        components: rows,
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handles animal selection after user picks an animal
 */
async function handleAnimalSelection(interaction) {
    const parts = interaction.customId.split('_');
    const lotteryId = parts[2];
    const selectedAnimal = parts[3];

    let lottery;
    try {
        lottery = await lotteryModel.findById(lotteryId);
    } catch (error) {
        console.error('Invalid lottery ID:', error);
        return await interaction.update({
            content: '❌ Invalid lottery.',
            components: []
        });
    }

    if (!lottery || lottery.status === 'ended') {
        return await interaction.update({
            content: '❌ This lottery has already ended!',
            components: []
        });
    }

    const alreadyBet = lottery.participants.some(p => p.userId === interaction.user.id);
    if (alreadyBet) {
        const existingBet = lottery.participants.find(p => p.userId === interaction.user.id);
        return await interaction.update({
            content: `❌ You already bet on ${existingBet.animal}!`,
            components: []
        });
    }

    const profileData = await dbUtils.ensureProfile(interaction.user.id, interaction.guild.id);

    if (profileData.balance < ANIMAL_LOTTERY_COST) {
        return await interaction.update({
            content: `❌ You need ${ANIMAL_LOTTERY_COST} points!`,
            components: []
        });
    }

    // Deduct cost
    profileData.balance -= ANIMAL_LOTTERY_COST;
    await profileData.save();

    // Add to prize pool
    lottery.prizePool += ANIMAL_LOTTERY_COST;

    // Add participant
    lottery.participants.push({
        userId: interaction.user.id,
        username: interaction.user.username,
        timestamp: Date.now(),
        animal: selectedAnimal
    });

    await lottery.save();

    // Trigger balance change event
    try {
        const balanceChangeEvent = require('../balanceChange');
        balanceChangeEvent.execute(interaction.member);
    } catch (err) {
        console.error('Failed to trigger balance change event:', err);
    }

    // Update main lottery message
    const channel = interaction.guild.channels.cache.get(lottery.channelId);
    if (channel && lottery.messageId) {
        try {
            const message = await channel.messages.fetch(lottery.messageId);
            const embed = createLotteryEmbed(lottery);
            await message.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to update lottery message:', error);
        }
    }

    // Log to thread
    if (lottery.logThreadId) {
        try {
            const thread = await interaction.client.channels.fetch(lottery.logThreadId);
            if (thread) {
                const logEmbed = new EmbedBuilder()
                    .setDescription(`${selectedAnimal} **${interaction.user.username}** bet on ${selectedAnimal}!`)
                    .setColor(0xF39C12)
                    .setTimestamp();

                await thread.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            console.error('Failed to log to thread:', error);
        }
    }

    await interaction.update({
        content: `✅ You bet ${ANIMAL_LOTTERY_COST} points on ${selectedAnimal}!\n\nPrize pool: ${lottery.prizePool.toLocaleString()} points\nYour balance: ${profileData.balance.toLocaleString()} points`,
        components: []
    });
}

module.exports = { handleLotteryButtons, handleAnimalSelection };
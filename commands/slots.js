const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const dbUtils = require('../utils/dbUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Play the slot machine!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount to bet')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, profileData) {
        try {
            const betAmount = interaction.options.getInteger('bet');

            if (profileData.balance < betAmount) {
                return await interaction.reply({
                    content: `❌ Insufficient balance! You have ${profileData.balance.toLocaleString()} points.`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Spin the reels
            const reel1 = getSymbol();
            const reel2 = getSymbol();
            const reel3 = getSymbol();

            const result = calculatePayout(reel1, reel2, reel3, betAmount);

            const netChange = (betAmount * result.multiplier) - betAmount;
            profileData.balance += netChange;
            await profileData.save();

            // Trigger balance change event
            try {
                const balanceChangeEvent = require('../events/balanceChange');
                balanceChangeEvent.execute(interaction.member);
            } catch (err) {
                console.error('Failed to trigger balance change event:', err);
            }

            const slotsEmbed = new EmbedBuilder()
                .setTitle('🎰 Slot Machine')
                .setDescription(`\`\`\`\n[ ${reel1} | ${reel2} | ${reel3} ]\n\`\`\`\n${result.message}`)
                .addFields(
                    { name: 'Bet', value: `${betAmount.toLocaleString()} points`, inline: true },
                    { name: 'Win/Loss', value: `${netChange >= 0 ? '+' : ''}${netChange.toLocaleString()} points`, inline: true },
                    { name: 'New Balance', value: `${profileData.balance.toLocaleString()} points`, inline: true }
                )
                .setColor(result.color)
                .setFooter({ text: 'Match 3 for big wins! 💰' })
                .setTimestamp();

            await interaction.reply({ embeds: [slotsEmbed] });

        } catch (error) {
            console.error('Error in slots command:', error);
            const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
            await interaction[replyMethod]({
                content: '❌ An error occurred while playing slots.',
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};

/**
 * Get weighted random symbol (balanced for house edge)
 */
function getSymbol() {
    const rand = Math.random() * 100;

    // Ultra Rare (0.6% total)
    if (rand < 0.3) {
        return '💰'; // 0.3%
    }
    if (rand < 0.6) {
        return '👑'; // 0.3%
    }

    // Super Rare (2.4% total)
    if (rand < 1.2) {
        return '💎'; // 0.6%
    }
    if (rand < 2.1) {
        return '7️⃣'; // 0.9%
    }
    if (rand < 3.0) {
        return '⭐'; // 0.9%
    }

    // Rare (12% total)
    if (rand < 7) {
        return '🍇'; // 4%
    }
    if (rand < 11) {
        return '🍊'; // 4%
    }
    if (rand < 15) {
        return '🍉'; // 4%
    }

    // Common (85% total)
    if (rand < 50) {
        return '🍒'; // 35%
    }
    return '🍋'; // 50%
}

/**
 * Calculate payout (true 50/50 balanced with house edge)
 */
function calculatePayout(reel1, reel2, reel3, betAmount) {
    // Check for triple match (jackpot)
    if (reel1 === reel2 && reel2 === reel3) {
        return getTripleMatchPayout(reel1, betAmount);
    }

    // Check for double match (reduced payouts)
    if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
        return getDoubleMatchPayout(reel1, reel2, reel3, betAmount);
    }

    // Total loss (no consolation prizes)
    return {
        multiplier: 0,
        message: '💔 **No Match!** Better luck next time.',
        color: 0xE74C3C
    };
}

/**
 * Triple match payouts (big wins but rare)
 */
function getTripleMatchPayout(symbol, betAmount) {
    const payouts = {
        '💰': { mult: 100, msg: '🎰💰🎰 **MEGA JACKPOT!!!** Triple Money Bags!', color: 0xFFD700 },
        '👑': { mult: 50, msg: '👑👑👑 **ROYAL FLUSH!** Triple Crowns!', color: 0x9B59B6 },
        '💎': { mult: 30, msg: '💎💎💎 **DIAMOND TRIPLE!**', color: 0x3498DB },
        '7️⃣': { mult: 25, msg: '7️⃣7️⃣7️⃣ **TRIPLE SEVENS!**', color: 0xFF0000 },
        '⭐': { mult: 20, msg: '⭐⭐⭐ **TRIPLE STARS!**', color: 0xF39C12 },
        '🍇': { mult: 10, msg: '🍇🍇🍇 **TRIPLE GRAPES!**', color: 0x8E44AD },
        '🍊': { mult: 8, msg: '🍊🍊🍊 **TRIPLE ORANGES!**', color: 0xE67E22 },
        '🍉': { mult: 6, msg: '🍉🍉🍉 **TRIPLE MELONS!**', color: 0xE74C3C },
        '🍒': { mult: 4, msg: '🍒🍒🍒 **TRIPLE CHERRIES!**', color: 0xC0392B },
        '🍋': { mult: 3, msg: '🍋🍋🍋 **TRIPLE LEMONS!**', color: 0xF1C40F }
    };

    const payout = payouts[symbol] || payouts['🍋'];
    return {
        multiplier: payout.mult,
        message: `${payout.msg} You won ${(betAmount * payout.mult).toLocaleString()} points! (${payout.mult}x)`,
        color: payout.color
    };
}

/**
 * Double match payouts (much lower to maintain house edge)
 */
function getDoubleMatchPayout(reel1, reel2, reel3, betAmount) {
    // Find matched symbol
    const symbols = [reel1, reel2, reel3];
    const matched = symbols.find((s, i) => symbols.indexOf(s) !== i);

    const payouts = {
        '💰': { mult: 15, tier: 'ultra' },    // ⬇️ 
        '👑': { mult: 7, tier: 'ultra' },    // ⬇️ 
        '💎': { mult: 5, tier: 'super' },  // ⬇️ 
        '7️⃣': { mult: 4, tier: 'super' },  // ⬇️ 
        '⭐': { mult: 3, tier: 'super' },    // ⬇️ 
        '🍇': { mult: 2.5, tier: 'rare' },   // ⬇️ 
        '🍊': { mult: 2, tier: 'rare' },   // ⬇️ 
        '🍉': { mult: 1.5, tier: 'rare' },     // ⬇️ 
        '🍒': { mult: 0.9, tier: 'common' },// ⬇️ //changed to around 2 % house edge from 1 -> 0.9
        '🍋': { mult: 0.5, tier: 'common' }  // ⬇️ 
    };

    const payout = payouts[matched] || payouts['🍋'];
    const colors = { ultra: 0xAD1457, super: 0x2ECC71, rare: 0xF39C12, common: 0x95A5A6 };

    return {
        multiplier: payout.mult,
        message: `✨ **DOUBLE ${matched}!** You ${payout.mult > 1 ? 'won' : 'get back'} ${(betAmount * payout.mult).toLocaleString()} points! (${payout.mult}x)`,
        color: colors[payout.tier]
    };
}
const profileModel = require('../models/profileSchema');

/**
 * Calculate interest rate based on bank balance
 * Formula: rate = 0.01 / (1 + (balance / 50000)^0.75)
 * Exponentially decays but allows reasonable earnings for large balances
 * 
 * Examples:
 * - 1 point: ~1% hourly
 * - 50,000 points: ~0.5% hourly
 * - 500,000 points: ~0.151% hourly
 * - 1,000,000 points: ~0.062% hourly (~15k-16k points/day)
 */
function calculateInterestRate(bankBalance) {
    const baseRate = 0.01; // 1% maximum for low balances
    const inflectionPoint = 55483; // Optimized balance where rate is ~0.5%
    const exponent = 0.7; // Optimized for slightly slower decay at high balances

    const rate = baseRate / (1 + Math.pow(bankBalance / inflectionPoint, exponent));
    return Math.max(rate, 0); // No negative rates
}

/**
 * Apply interest to all user banks
 */
async function applyBankInterest() {
    try {
        console.log('🏦 Running bank interest calculation...');

        // Get all profiles with banks
        const profiles = await profileModel.find({ bankOwned: true, bankBalance: { $gt: 0 } });

        let totalUsersReceivingInterest = 0;
        let totalPointsGenerated = 0;

        for (const profile of profiles) {
            const rate = calculateInterestRate(profile.bankBalance);
            const interestEarned = Math.floor(profile.bankBalance * rate);

            if (interestEarned > 0) {
                profile.bankBalance += interestEarned;
                await profile.save();
                totalUsersReceivingInterest++;
                totalPointsGenerated += interestEarned;
            }
        }

        console.log(`✅ Bank interest applied to ${totalUsersReceivingInterest} users | Total generated: ${totalPointsGenerated.toLocaleString()} points`);
    } catch (error) {
        console.error('❌ Error applying bank interest:', error);
    }
}

/**
 * Start the bank interest scheduler
 * Runs every hour (3600000 ms)
 */
function startBankInterestScheduler() {
    console.log('🕐 Bank interest scheduler started (runs every hour)');

    // Run immediately on startup
    applyBankInterest();

    // Then run every hour
    setInterval(applyBankInterest, 3600000); // 1 hour in milliseconds
}

module.exports = {
    startBankInterestScheduler,
    calculateInterestRate,
    applyBankInterest
};

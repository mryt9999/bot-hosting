const { Events } = require('discord.js');
const profileModel = require('../models/profileSchema');
const mongoose = require('mongoose');
const { roleRequirements } = require('../globalValues.json');
const { rescheduleActiveLoans, startPendingLoanCleanup, autoRepayOverdueLoans } = require('../commands/loan');
const { initializeArcaneRoleChecker } = require('../schedulers/arcaneRoleChecker');

const lotteryModel = require('../models/lotterySchema');
const { scheduleRaffleEnd, createNumberLottery, createRaffleLottery, archiveLottery } = require('../utils/lotteryManager');

const LOTTERY_ARCHIVAL_DELAY = 60 * 60 * 1000; // 1 hour in milliseconds

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            await client.application?.fetch();
            console.log(`Ready — application id: ${client.application?.id}`);
        } catch (err) {
            console.warn('Could not fetch client.application on ready:', err?.message ?? err);
        }

        console.log(`Ready! Logged in as ${client.user.tag}`);

        initializeArcaneRoleChecker(client);

        // Reschedule active loans
        try {
            await rescheduleActiveLoans(client);
        } catch (error) {
            console.error('Failed to reschedule active loans:', error);
        }

        // Start pending loan cleanup //
        try {
            startPendingLoanCleanup(client);
        } catch (error) {
            console.error('Failed to start pending loan cleanup:', error);
        }

        // Auto-repay overdue loans check
        setInterval(async () => {
            try {
                await autoRepayOverdueLoans(client);
                console.log('Checked for overdue loans requiring auto-repayment');
            } catch (error) {
                console.error('Error checking overdue loans:', error);
            }
        }, 60 * 60 * 1000);

        // Reschedule active raffle lotteries
        try {
            const activeRaffles = await lotteryModel.find({
                type: 'raffle',
                status: 'active'
            });

            for (const raffle of activeRaffles) {
                if (raffle.endsAt > Date.now()) {
                    scheduleRaffleEnd(raffle._id, raffle.endsAt, client);
                    console.log(`[Lottery] Rescheduled raffle lottery ${raffle._id}`);
                }
            }
        } catch (error) {
            console.error('Error rescheduling raffle lotteries:', error);
        }

        // Recover unarchived lotteries (bot was offline during archival time)
        try {
            const unarchivedLotteries = await lotteryModel.find({
                status: 'ended',
                archived: { $ne: true }
            });

            for (const lottery of unarchivedLotteries) {
                const guild = client.guilds.cache.get(lottery.serverID);
                if (!guild) {
                    console.log(`[Lottery] Skipping lottery ${lottery._id} - guild not found`);
                    continue;
                }

                const timeSinceEnd = Date.now() - (lottery.endedAt || 0);

                if (timeSinceEnd >= 60 * 60 * 1000) {
                    // Should have been archived - do it now
                    console.log(`[Lottery] Archiving lottery that ended during downtime: ${lottery._id}`);

                    const winnerId = lottery.winnerId;
                    const winningNumber = lottery.type === 'number'
                        ? lottery.participants.find(p => p.userId === winnerId)?.number
                        : null;

                    await archiveLottery(lottery, client, winnerId, winningNumber);
                } else {
                    // Schedule for remaining time
                    const delay = 60 * 60 * 1000 - timeSinceEnd;
                    console.log(`[Lottery] Scheduling delayed archival for ${lottery._id} in ${Math.round(delay / 1000)}s`);

                    const winnerId = lottery.winnerId;
                    const winningNumber = lottery.type === 'number'
                        ? lottery.participants.find(p => p.userId === winnerId)?.number
                        : null;

                    setTimeout(() => archiveLottery(lottery, client, winnerId, winningNumber), delay);
                }
            }
        } catch (error) {
            console.error('Error recovering unarchived lotteries:', error);
        }

        // Auto-create lotteries if none exist
        try {
            setTimeout(async () => {
                for (const [guildId, guild] of client.guilds.cache) {
                    console.log(`[Lottery] Checking lotteries for guild: ${guild.name} (${guildId})`);

                    // Check for active number lottery
                    const activeNumberLottery = await lotteryModel.findOne({
                        serverID: guildId,
                        type: 'number',
                        status: 'active'
                    });

                    if (!activeNumberLottery) {
                        console.log('[Lottery] No active number lottery found, creating one...');
                        const created = await createNumberLottery(client, guildId);
                        if (created) {
                            console.log(`[Lottery] ✅ Created number lottery: ${created._id}`);
                        } else {
                            console.log('[Lottery] ❌ Failed to create number lottery (may be on cooldown)');
                        }
                    } else {
                        console.log(`[Lottery] Number lottery already active: ${activeNumberLottery._id}`);
                    }

                    // Check for active raffle lottery
                    const activeRaffleLottery = await lotteryModel.findOne({
                        serverID: guildId,
                        type: 'raffle',
                        status: 'active'
                    });

                    if (!activeRaffleLottery) {
                        console.log('[Lottery] No active raffle lottery found, creating one...');
                        const created = await createRaffleLottery(client, guildId);
                        if (created) {
                            console.log(`[Lottery] ✅ Created raffle lottery: ${created._id}`);
                        } else {
                            console.log('[Lottery] ❌ Failed to create raffle lottery (may be on cooldown)');
                        }
                    } else {
                        console.log(`[Lottery] Raffle lottery already active: ${activeRaffleLottery._id}`);
                    }
                }
            }, 5000);
        } catch (error) {
            console.error('Error auto-creating lotteries:', error);
        }

        // Guild member join event
        client.on(Events.GuildMemberAdd, async (member) => {
            try {
                let profile = await profileModel.findOne({ userId: member.id });

                if (!profile) {
                    profile = await profileModel.create({
                        userId: member.id,
                        serverID: member.guild.id,
                    });

                    try {
                        await member.send(`Welcome to ${member.guild.name}! Your economy profile has been created.`);
                    } catch (dmError) {
                        console.log(`Couldn't send DM to ${member.user.tag}`);
                    }

                    console.log(`Created profile for new member: ${member.user.tag}`);
                }
            } catch (error) {
                console.error(`Error handling new member ${member.user.tag}:`, error);

                const systemChannel = member.guild.systemChannel;
                if (systemChannel) {
                    systemChannel.send(`Failed to create profile for new member ${member.user.tag}. Please check logs.`);
                }
            }
        });

        // Database connection error handler
        mongoose.connection.on('error', (error) => {
            console.error('Database connection error:', error);
        });
    }
};
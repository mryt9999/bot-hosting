const { Events } = require('discord.js');
const profileModel = require('../models/profileSchema');
const mongoose = require('mongoose');
const { rescheduleActiveLoans } = require('../commands/loan');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            // ensure application id is available for webhook deletes
            await client.application?.fetch();
            console.log(`Ready — application id: ${client.application?.id}`);
        } catch (_err) {
            console.warn('Could not fetch client.application on ready:', _err?.message ?? _err);
        }

        console.log(`Ready! Logged in as ${client.user.tag}`);

        // Reschedule active loans for enforcement
        try {
            await rescheduleActiveLoans(client);
        } catch (error) {
            console.error('Failed to reschedule active loans:', error);
        }

        // Set up event handler for when members join
        client.on(Events.GuildMemberAdd, async (member) => {
            try {
                // Check if profile exists
                let profile = await profileModel.findOne({ userId: member.id });

                // If no profile exists, create one
                if (!profile) {
                    profile = await profileModel.create({
                        userId: member.id,
                        serverID: member.guild.id,
                    });

                    // Send welcome message with profile creation confirmation
                    try {
                        await member.send(`Welcome to ${member.guild.name}! Your economy profile has been created.`);
                    } catch (_dmError) {
                        console.log(`Couldn't send DM to ${member.user.tag}`);
                    }

                    console.log(`Created profile for new member: ${member.user.tag}`);
                }
            } catch (error) {
                console.error(`Error handling new member ${member.user.tag}:`, error);

                // Attempt to notify admins if there's a critical error
                const systemChannel = member.guild.systemChannel;
                if (systemChannel) {
                    systemChannel.send(`Failed to create profile for new member ${member.user.tag}. Please check logs.`);
                }
            }
        });

        //whenever a member gets a new ArcaneRole give him arcanerolereward for that role




        // Log any database connection issues
        mongoose.connection.on('error', (error) => {
            console.error('Database connection error:', error);
        });
    }
};

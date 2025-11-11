const { Events } = require('discord.js');
const profileModel = require("../models/profileSchema");
const { roleRequirements } = require("../globalValues.json");
const { ArcaneRoleRewards } = require("../globalValues.json");


//whenever a member gets a new ArcaneRole give him arcanerolereward for that role
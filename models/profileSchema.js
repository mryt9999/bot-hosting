const mongoose = require("mongoose");
const profileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    serverID: { type: String, required: true },
    balance: { type: Number, default: 100 },
    lastDaily: { type: Number, default: 0 },
});

const model = mongoose.model("economydb", profileSchema);

module.exports = model;

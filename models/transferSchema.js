const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    serverID: { type: String, required: true },
    transferDescription: { type: String, required: true },//eq. 8 radiants, 18 plasmas, 20 quantums.
    pointsPaid: { type: Number, required: true },
    createdAt: { type: Number, default: Date.now },
    paidAt: { type: Date },
    status: { type: String, enum: ['pending', 'paid', 'defaulted'], default: 'pending' },
});


const model = mongoose.model('transferdb', transferSchema);

module.exports = model;

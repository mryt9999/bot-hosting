const mongoose = require('mongoose');

/**
 * Loan schema for the economy system
 * @typedef {Object} LoanSchema
 * @property {string} lenderId - Discord user ID of the lender
 * @property {string} borrowerId - Discord user ID of the borrower
 * @property {string} serverID - Discord server/guild ID
 * @property {number} loanAmount - Amount loaned to the borrower
 * @property {number} paybackAmount - Amount to be paid back (can include interest)
 * @property {number} duration - Duration of the loan in milliseconds
 * @property {number} createdAt - Timestamp when loan contract was created
 * @property {number} acceptedAt - Timestamp when loan was accepted (0 if pending)
 * @property {number} dueAt - Timestamp when loan is due (0 if not accepted yet)
 * @property {string} status - Status of the loan: 'pending', 'active', 'overdue', 'paid', 'defaulted'
 * @property {number} amountPaid - Amount already paid back (for partial payments)
 */
const loanSchema = new mongoose.Schema({
    lenderId: { type: String, required: true },
    borrowerId: { type: String, required: true },
    serverID: { type: String, required: true },
    loanAmount: { type: Number, required: true },
    paybackAmount: { type: Number, required: true },
    duration: { type: Number, required: true },
    createdAt: { type: Number, default: Date.now },
    acceptedAt: { type: Number, default: 0 },
    dueAt: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'active', 'overdue', 'paid', 'defaulted'], default: 'pending' },
    amountPaid: { type: Number, default: 0 },
});

const model = mongoose.model('loandb', loanSchema);

module.exports = model;

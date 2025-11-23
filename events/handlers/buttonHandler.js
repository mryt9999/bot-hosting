const { handleRPSChallenge, handleRPSChoice } = require('./games/rpsHandler');
const { handleTicTacToeChallenge, handleTicTacToeMove, handleTicTacToeForfeit } = require('./games/tictactoeHandler');
const { handleConnect4Challenge, handleConnect4Move, handleConnect4Forfeit } = require('./games/connect4Handler');
const { handleLotteryButtons } = require('./lotteryHandler');
const {
    handleHelpButtons,
    handleTransferButtons,
    handleLoanButtons,
    handleCommandMenuButtons,
    handleCloseBackButtons
} = require('./miscButtonHandler');

/**
 * Routes button interactions to appropriate handlers
 */
async function handleButtonInteraction(interaction, profileData, replyEphemeral) {
    // RPS game buttons
    if (interaction.customId.startsWith('rps_accept_') || interaction.customId.startsWith('rps_decline_')) {
        return await handleRPSChallenge(interaction);
    }

    if (interaction.customId.startsWith('rps_choice_')) {
        return await handleRPSChoice(interaction);
    }

    // Tic Tac Toe game buttons
    if (interaction.customId.startsWith('ttt_accept_') || interaction.customId.startsWith('ttt_decline_')) {
        return await handleTicTacToeChallenge(interaction);
    }

    if (interaction.customId.startsWith('ttt_move_')) {
        return await handleTicTacToeMove(interaction);
    }

    if (interaction.customId.startsWith('ttt_forfeit_')) {
        return await handleTicTacToeForfeit(interaction);
    }

    // Connect 4 game buttons
    if (interaction.customId.startsWith('c4_accept_') || interaction.customId.startsWith('c4_decline_')) {
        return await handleConnect4Challenge(interaction);
    }

    if (interaction.customId.startsWith('c4_drop_')) {
        return await handleConnect4Move(interaction);
    }

    if (interaction.customId.startsWith('c4_forfeit_')) {
        return await handleConnect4Forfeit(interaction);
    }

    // Lottery buttons
    if (interaction.customId.startsWith('lottery_')) {
        return await handleLotteryButtons(interaction);
    }

    // Help buttons
    if (await handleHelpButtons(interaction)) {
        return;
    }

    // Transfer buttons
    if (await handleTransferButtons(interaction)) {
        return;
    }

    // Loan buttons
    if (await handleLoanButtons(interaction)) {
        return;
    }

    // Command menu buttons
    if (await handleCommandMenuButtons(interaction, profileData, replyEphemeral)) {
        return;
    }

    // Close/back buttons
    if (await handleCloseBackButtons(interaction)) {
        return;
    }
}

module.exports = { handleButtonInteraction };

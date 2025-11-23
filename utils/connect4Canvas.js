const { createCanvas } = require('canvas');

/**
 * Creates a Connect 4 board image
 * @param {Array<Array<string>>} board - 6x7 2D array with '', 'R', or 'Y'
 * @returns {Buffer} PNG image buffer
 */
function createConnect4Image(board) {
    const COLS = 7;
    const ROWS = 6;
    const CELL_SIZE = 100;
    const PADDING = 25;
    const HEADER_HEIGHT = 80;

    const width = COLS * CELL_SIZE + PADDING * 2;
    const height = ROWS * CELL_SIZE + PADDING * 2 + HEADER_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background - Discord dark theme
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, width, height);

    // Board background - slightly lighter
    const boardX = PADDING;
    const boardY = HEADER_HEIGHT;
    const boardWidth = COLS * CELL_SIZE;
    const boardHeight = ROWS * CELL_SIZE;

    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(boardX, boardY, boardWidth, boardHeight);

    // Column numbers - Clean Discord style
    ctx.font = '600 36px "Whitney", "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#b5bac1';

    for (let col = 0; col < COLS; col++) {
        const x = boardX + col * CELL_SIZE + CELL_SIZE / 2;
        const y = HEADER_HEIGHT / 2;
        ctx.fillText((col + 1).toString(), x, y);
    }

    // Draw slots and pieces
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const centerX = boardX + col * CELL_SIZE + CELL_SIZE / 2;
            const centerY = boardY + row * CELL_SIZE + CELL_SIZE / 2;
            const radius = 38;

            const cell = board[row][col];

            if (cell === 'R') {
                // Red piece with subtle shading

                // Light shadow underneath
                ctx.beginPath();
                ctx.arc(centerX + 1, centerY + 2, radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.fill();

                // Main piece - subtle gradient
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);

                const redGradient = ctx.createRadialGradient(
                    centerX - 5, centerY - 5, 0,
                    centerX, centerY, radius
                );
                redGradient.addColorStop(0, '#f05454');
                redGradient.addColorStop(0.7, '#ed4245');
                redGradient.addColorStop(1, '#c23030');
                ctx.fillStyle = redGradient;
                ctx.fill();

                // Small subtle highlight
                ctx.beginPath();
                ctx.arc(centerX - 12, centerY - 10, 6, 0, Math.PI * 2);
                const highlightGradient = ctx.createRadialGradient(
                    centerX - 12, centerY - 10, 0,
                    centerX - 12, centerY - 10, 6
                );
                highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
                highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = highlightGradient;
                ctx.fill();

            } else if (cell === 'Y') {
                // Yellow piece with subtle shading

                // Light shadow underneath
                ctx.beginPath();
                ctx.arc(centerX + 1, centerY + 2, radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.fill();

                // Main piece - subtle gradient
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);

                const yellowGradient = ctx.createRadialGradient(
                    centerX - 5, centerY - 5, 0,
                    centerX, centerY, radius
                );
                yellowGradient.addColorStop(0, '#ffd95a');
                yellowGradient.addColorStop(0.7, '#faa61a');
                yellowGradient.addColorStop(1, '#e09200');
                ctx.fillStyle = yellowGradient;
                ctx.fill();

                // Small subtle highlight
                ctx.beginPath();
                ctx.arc(centerX - 12, centerY - 10, 6, 0, Math.PI * 2);
                const highlightGradient = ctx.createRadialGradient(
                    centerX - 12, centerY - 10, 0,
                    centerX - 12, centerY - 10, 6
                );
                highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
                highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = highlightGradient;
                ctx.fill();

            } else {
                // Empty slot - dark gray with subtle inset effect
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fillStyle = '#313338';
                ctx.fill();

                // Inner shadow for depth
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
                ctx.strokeStyle = '#1e1f22';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Subtle border for all circles
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = '#1e1f22';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Clean border around board
    ctx.strokeStyle = '#40444b';
    ctx.lineWidth = 3;
    ctx.strokeRect(boardX, boardY, boardWidth, boardHeight);

    return canvas.toBuffer('image/png');
}

module.exports = {
    createConnect4Image
};
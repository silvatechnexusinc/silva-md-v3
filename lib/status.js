// lib/status.js
const { delay } = require('@whiskeysockets/baileys');

class StatusHandler {
    /**
     * Handle status messages
     * @param {Array} messages - Array of messages
     * @param {Object} sock - WhatsApp socket
     * @param {Object} options - Configuration options
     * @param {Boolean} options.autoView - Auto view status
     * @param {Boolean} options.autoLike - Auto like status
     * @param {Object} options.logger - Logger instance
     */
    async handleStatus(messages, sock, options = {}) {
        const { autoView = false, autoLike = false, logger } = options;
        
        if (!messages || !Array.isArray(messages)) return;
        
        for (const message of messages) {
            try {
                if (message.key.remoteJid === 'status@broadcast') {
                    if (logger) {
                        logger.log('INFO', '📊 Status update detected');
                    }
                    
                    // Auto view status
                    if (autoView) {
                        try {
                            await sock.readMessages([message.key]);
                            if (logger) {
                                logger.log('SUCCESS', '✅ Status auto-viewed');
                            }
                        } catch (error) {
                            if (logger) {
                                logger.log('ERROR', 'Failed to auto-view status: ' + error.message);
                            }
                        }
                    }
                    
                    // Auto like status
                    if (autoLike) {
                        try {
                            await delay(1000); // Wait a second before liking
                            await sock.sendMessage(message.key.remoteJid, {
                                react: {
                                    text: '❤️',
                                    key: message.key
                                }
                            });
                            if (logger) {
                                logger.log('SUCCESS', '✅ Status auto-liked');
                            }
                        } catch (error) {
                            if (logger) {
                                logger.log('ERROR', 'Failed to auto-like status: ' + error.message);
                            }
                        }
                    }
                }
            } catch (error) {
                if (logger) {
                    logger.log('ERROR', 'Status handling error: ' + error.message);
                }
            }
        }
    }
}

module.exports = new StatusHandler();

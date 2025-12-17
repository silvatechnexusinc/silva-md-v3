// lib/status.js
const { delay } = require('@whiskeysockets/baileys');

class StatusHandler {
    /**
     * Handle WhatsApp status updates
     */
    async handle({ messages, type, sock, config, logMessage, unwrapStatus, saveMedia }) {
        try {
            // Process only real-time events
            if (type && !['notify', 'append'].includes(type)) {
                logMessage?.('DEBUG', `Skipping message type: ${type}`);
                return;
            }

            if (!Array.isArray(messages)) return;

            for (const m of messages) {
                if (m.key?.remoteJid !== 'status@broadcast') continue;

                try {
                    const statusId = m.key.id;
                    const userJid = m.key.participant;

                    logMessage?.('EVENT', `📊 Status update from ${userJid}: ${statusId}`);

                    const { inner, msgType } = unwrapStatus
                        ? unwrapStatus(m)
                        : {
                            inner: m.message,
                            msgType: Object.keys(m.message || {})[0]
                        };

                    // ✅ AUTO VIEW
                    if (config?.AUTO_STATUS_SEEN) {
                        try {
                            await sock.readMessages([m.key]);
                            logMessage?.('INFO', `👀 Status viewed: ${statusId}`);
                        } catch (e) {
                            logMessage?.('WARN', `Status view failed: ${e.message}`);
                        }
                    }

                    // ✅ AUTO REACT
                    if (config?.AUTO_STATUS_REACT) {
                        try {
                            const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏')
                                .split(',')
                                .map(e => e.trim());

                            const emoji = emojis[Math.floor(Math.random() * emojis.length)];

                            await delay(800);
                            await sock.sendMessage(userJid, {
                                react: {
                                    text: emoji,
                                    key: {
                                        remoteJid: 'status@broadcast',
                                        id: statusId,
                                        participant: userJid
                                    }
                                }
                            });

                            logMessage?.('INFO', `❤️ Reacted with ${emoji}`);
                        } catch (e) {
                            logMessage?.('WARN', `Status react failed: ${e.message}`);
                        }
                    }

                    // ✅ AUTO REPLY
                    if (config?.AUTO_STATUS_REPLY) {
                        try {
                            await sock.sendMessage(userJid, {
                                text: config.AUTO_STATUS_MSG || '💖 Silva MD viewed your status',
                                contextInfo: {
                                    stanzaId: statusId,
                                    participant: userJid,
                                    quotedMessage: inner
                                }
                            });
                            logMessage?.('INFO', `💬 Status replied`);
                        } catch (e) {
                            logMessage?.('WARN', `Status reply failed: ${e.message}`);
                        }
                    }

                    // ✅ STATUS SAVER (optional)
                    if (config?.Status_Saver === 'true' && saveMedia) {
                        try {
                            const userName = await sock.getName(userJid) || 'Unknown';
                            let caption = `AUTO STATUS SAVER\n\n🩵 Status From: ${userName}`;

                            switch (msgType) {
                                case 'imageMessage':
                                case 'videoMessage':
                                case 'audioMessage':
                                    await saveMedia({ message: inner }, msgType, sock, caption);
                                    break;

                                case 'extendedTextMessage':
                                    await sock.sendMessage(sock.user.id, {
                                        text: inner.extendedTextMessage?.text || ''
                                    });
                                    break;

                                default:
                                    logMessage?.('WARN', `Unsupported status type: ${msgType}`);
                            }

                            logMessage?.('INFO', `💾 Status saved: ${statusId}`);
                        } catch (e) {
                            logMessage?.('ERROR', `Status save failed: ${e.message}`);
                        }
                    }

                } catch (err) {
                    logMessage?.('ERROR', `Status handler crash: ${err.message}`);
                }
            }
        } catch (fatal) {
            logMessage?.('ERROR', `Fatal status module error: ${fatal.message}`);
        }
    }
}

module.exports = new StatusHandler();

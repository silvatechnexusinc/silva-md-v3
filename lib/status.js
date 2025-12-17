const { delay } = require('@whiskeysockets/baileys');

class StatusHandler {
    async handle({ messages, type, sock, config, logMessage, unwrapStatus, saveMedia }) {
        try {
            if (type && !['notify', 'append'].includes(type)) return;
            if (!Array.isArray(messages)) return;

            for (const m of messages) {
                if (m.key?.remoteJid !== 'status@broadcast') continue;

                try {
                    // Safely unwrap the status
                    const statusData = unwrapStatus?.(m) || {};
                    const { inner, msgType } = statusData;

                    if (!inner) {
                        logMessage?.('DEBUG', 'Skipping empty or unsupported status payload');
                        continue; // skip if message cannot be decrypted
                    }

                    const statusId = m.key.id;
                    const userJid = m.key.participant;

                    logMessage?.('EVENT', `📊 Status update from ${userJid}: ${statusId}`);

                    // AUTO VIEW
                    if (config?.AUTO_STATUS_SEEN) {
                        sock.readMessages([m.key]).catch(e => {
                            logMessage?.('WARN', `Status view failed: ${e.message}`);
                        });
                    }

                    // AUTO REACT
                    if (config?.AUTO_STATUS_REACT) {
                        const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏')
                            .split(',')
                            .map(e => e.trim());
                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];

                        // non-blocking delay
                        setTimeout(async () => {
                            try {
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
                        }, 500);
                    }

                    // AUTO REPLY
                    if (config?.AUTO_STATUS_REPLY) {
                        sock.sendMessage(userJid, {
                            text: config.AUTO_STATUS_MSG || '💖 Silva MD viewed your status',
                            contextInfo: {
                                stanzaId: statusId,
                                participant: userJid,
                                quotedMessage: inner
                            }
                        }).catch(e => {
                            logMessage?.('WARN', `Status reply failed: ${e.message}`);
                        });
                    }

                    // STATUS SAVER
                    if (config?.Status_Saver === 'true' && saveMedia) {
                        try {
                            const userName = await sock.getName(userJid) || 'Unknown';
                            let caption = `AUTO STATUS SAVER\n\n🩵 Status From: ${userName}`;
                            if (['imageMessage','videoMessage','audioMessage'].includes(msgType)) {
                                await saveMedia({ message: inner }, msgType, sock, caption);
                                logMessage?.('INFO', `💾 Status saved: ${statusId}`);
                            }
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

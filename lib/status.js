class StatusHandler {
    async handle({ messages, type, sock, config, logMessage, saveMedia }) {
        if (!['notify', 'append'].includes(type)) return;
        if (!Array.isArray(messages)) return;

        for (const m of messages) {
            if (m.key?.remoteJid !== 'status@broadcast') continue;

            const statusId = m.key.id;
            const userJid = m.key.participant;
            const content = m.message;

            if (!statusId || !userJid || !content) continue;

            logMessage?.('EVENT', `📊 Status from ${userJid} (${statusId})`);

            /* =======================
               👁️ AUTO VIEW STATUS
            ======================= */
            if (config?.AUTO_STATUS_SEEN) {
                try {
                    await sock.sendReadReceipt(
                        'status@broadcast',
                        userJid,
                        [statusId]
                    );
                    logMessage?.('INFO', '👁️ Status viewed');
                } catch (e) {
                    logMessage?.('WARN', `View failed: ${e.message}`);
                }
            }

            /* =======================
               ❤️ AUTO REACT
            ======================= */
            if (config?.AUTO_STATUS_REACT) {
                const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍')
                    .split(',')
                    .map(e => e.trim());

                const emoji = emojis[Math.floor(Math.random() * emojis.length)];

                try {
                    await sock.sendMessage('status@broadcast', {
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
                    logMessage?.('WARN', `React failed: ${e.message}`);
                }
            }

            /* =======================
               💬 AUTO REPLY (DM)
            ======================= */
            if (config?.AUTO_STATUS_REPLY) {
                try {
                    await sock.sendMessage(userJid, {
                        text: config.AUTO_STATUS_MSG || '💖 Silva MD saw your status'
                    });
                } catch (e) {
                    logMessage?.('WARN', `Reply failed: ${e.message}`);
                }
            }

            /* =======================
               💾 STATUS SAVER
            ======================= */
            if (config?.Status_Saver === 'true' && saveMedia) {
                try {
                    const type = Object.keys(content)[0];
                    if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return;

                    const name = await sock.getName(userJid) || 'Unknown';
                    await saveMedia(
                        { message: content },
                        type,
                        sock,
                        `🩵 Status from ${name}`
                    );

                    logMessage?.('INFO', '💾 Status saved');
                } catch (e) {
                    logMessage?.('ERROR', `Save failed: ${e.message}`);
                }
            }
        }
    }
}

module.exports = new StatusHandler();

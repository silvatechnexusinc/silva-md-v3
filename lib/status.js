const { downloadMediaMessage } = require('@whiskeysockets/baileys');

let lastStatus = null;

// Helper function to unwrap status messages
function unwrapStatus(m) {
    let inner = null;
    let msgType = null;

    if (m.message) {
        if (m.message.imageMessage) {
            inner = { ...m.message };
            msgType = 'imageMessage';
        } else if (m.message.videoMessage) {
            inner = { ...m.message };
            msgType = 'videoMessage';
        } else if (m.message.audioMessage) {
            inner = { ...m.message };
            msgType = 'audioMessage';
        } else if (m.message.extendedTextMessage) {
            inner = { ...m.message };
            msgType = 'extendedTextMessage';
        }
    }

    return { inner, msgType };
}

function setup(socket, config) {
    console.log('🔧 Setting up Status Handler...');

    // === 1. Capture and react/view to statuses ===
    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages) return;

        for (const m of messages) {
            // === STATUS STORY DETECTED ===
            if (m.key.remoteJid === 'status@broadcast' && m.key.participant) {
                try {
                    const userJid = m.key.participant;
                    const statusId = m.key.id;

                    console.log(`📊 Status from ${userJid}`);

                    const { inner, msgType } = unwrapStatus(m);

                    // Save last status for retrieval
                    lastStatus = { inner, msgType, userJid, statusId };

                    // AUTO VIEW
                    if (config.AUTO_VIEW_STATUS) {
                        await socket.readMessages([m.key]);
                        console.log(`👀 Viewed status`);
                    }

                    // AUTO REACT
                    if (config.AUTO_LIKE_STATUS) {
                        const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                        await socket.sendMessage(
                            'status@broadcast',
                            { react: { text: emoji, key: m.key } },
                            { statusJidList: [userJid] }
                        );
                        console.log(`❤️ Reacted with ${emoji}`);
                    }

                } catch (err) {
                    console.error('❌ Status handler error:', err.message);
                }
            }
        }
    });

    // === 2. LISTEN FOR STATUS REQUESTS ===
    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages) return;

        for (const m of messages) {
            if (!m.message || !m.key || !m.key.remoteJid) continue;

            const from = m.key.remoteJid;
            
            // Skip status broadcasts
            if (from === 'status@broadcast') continue;
            
            let text = '';
            if (m.message.conversation) {
                text = m.message.conversation.toLowerCase();
            } else if (m.message.extendedTextMessage?.text) {
                text = m.message.extendedTextMessage.text.toLowerCase();
            }

            if (!text) continue;

            // Check if text contains a keyword
            const triggered = config.STATUS_REQUEST_KEYWORDS.some(k => text.includes(k.toLowerCase()));

            if (!triggered) continue;

            // Must have a last viewed status
            if (!lastStatus) {
                await socket.sendMessage(from, { text: "❌ No viewed status available to send." });
                continue;
            }

            try {
                console.log(`📥 User requested status → ${from}`);

                const { inner, msgType } = lastStatus;
                const downloadMsg = { message: inner };

                const buffer = await downloadMediaMessage(downloadMsg, "buffer", {});

                if (msgType === 'imageMessage') {
                    await socket.sendMessage(from, {
                        image: buffer,
                        caption: "📸 *Here is the status you asked for*"
                    });
                }
                else if (msgType === 'videoMessage') {
                    await socket.sendMessage(from, {
                        video: buffer,
                        caption: "🎥 *Here is the status you asked for*"
                    });
                }
                else if (msgType === 'audioMessage') {
                    await socket.sendMessage(from, {
                        audio: buffer,
                        mimetype: 'audio/mp4'
                    });
                }
                else {
                    await socket.sendMessage(from, { 
                        text: "⚠ Status was text-only:\n\n" + inner?.extendedTextMessage?.text 
                    });
                }

                console.log('📤 Status sent on request');

            } catch (err) {
                console.error('❌ Failed to send requested status:', err.message);
            }
        }
    });

    console.log('✅ Status Handler Setup Complete');
}

module.exports = {
    setup,
    unwrapStatus,
    getLastStatus: () => lastStatus
};

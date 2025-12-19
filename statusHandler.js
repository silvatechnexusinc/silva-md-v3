const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Helper function to unwrap status messages
function unwrapStatus(m) {
    try {
        const message = m.message;
        const msgType = Object.keys(message)[0];
        return {
            inner: message,
            msgType: msgType
        };
    } catch (e) {
        return {
            inner: m.message,
            msgType: null
        };
    }
}

// Save media function
async function saveMedia(m, type, sock, caption = '') {
    try {
        const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: console });
        const fileName = `status_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        let fileExt = '';
        
        switch(type) {
            case 'imageMessage':
                fileExt = '.jpg';
                break;
            case 'videoMessage':
                fileExt = '.mp4';
                break;
            case 'audioMessage':
                fileExt = '.ogg';
                break;
            default:
                fileExt = '.dat';
        }
        
        const filePath = path.join(__dirname, 'status_media', fileName + fileExt);
        
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Save file
        fs.writeFileSync(filePath, buffer);
        
        // Send to saved messages/owner
        if (sock.user && sock.user.id) {
            const mediaMessage = {
                [type.replace('Message', '')]: {
                    url: filePath
                },
                caption: caption,
                mimetype: getMimeType(type),
                fileName: `${fileName}${fileExt}`
            };
            
            await sock.sendMessage(sock.user.id, mediaMessage);
        }
        
        return filePath;
    } catch (error) {
        throw new Error(`Failed to save media: ${error.message}`);
    }
}

function getMimeType(type) {
    switch(type) {
        case 'imageMessage': return 'image/jpeg';
        case 'videoMessage': return 'video/mp4';
        case 'audioMessage': return 'audio/ogg; codecs=opus';
        default: return 'application/octet-stream';
    }
}

class StatusHandler {
    constructor() {
        this.processedStatuses = new Set();
    }

    async handle({ messages, type, sock, config, logMessage }) {
        // ✅ FIX 1: Correct event filtering - process only real-time messages
        if (type && !['notify', 'append'].includes(type)) {
            logMessage('DEBUG', `Skipping message type: ${type}`);
            return;
        }

        if (!Array.isArray(messages)) return;

        for (const m of messages) {
            // ---- STATUS handling (status@broadcast)
            if (m.key.remoteJid === 'status@broadcast') {
                try {
                    const statusId = m.key.id;
                    const userJid = m.key.participant;
                    
                    // Skip if we've already processed this status
                    const statusKey = `${userJid}_${statusId}`;
                    if (this.processedStatuses.has(statusKey)) {
                        continue;
                    }
                    this.processedStatuses.add(statusKey);
                    
                    // Clean old processed statuses
                    if (this.processedStatuses.size > 1000) {
                        const keys = Array.from(this.processedStatuses);
                        for (let i = 0; i < 500; i++) {
                            this.processedStatuses.delete(keys[i]);
                        }
                    }
                    
                    logMessage('EVENT', `Status update from ${userJid}: ${statusId}`);

                    const { inner, msgType } = unwrapStatus(m);

                    // AUTO STATUS SEEN
                    if (config.AUTO_STATUS_SEEN) {
                        try {
                            await sock.readMessages([m.key]);
                            logMessage('INFO', `Status seen: ${statusId}`);
                        } catch (e) {
                            logMessage('WARN', `Status seen failed: ${e.message}`);
                        }
                    }

                    // AUTO STATUS REACT
                    if (config.AUTO_STATUS_REACT) {
                        try {
                            const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏').split(',');
                            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)].trim();
                            await sock.sendMessage(userJid, {
                                react: {
                                    text: randomEmoji,
                                    key: {
                                        remoteJid: 'status@broadcast',
                                        id: statusId,
                                        participant: userJid
                                    }
                                }
                            });
                            logMessage('INFO', `Reacted on status ${statusId} with: ${randomEmoji}`);
                        } catch (e) {
                            logMessage('WARN', `Status reaction failed: ${e.message}`);
                        }
                    }

                    // AUTO STATUS REPLY
                    if (config.AUTO_STATUS_REPLY) {
                        try {
                            await sock.sendMessage(userJid, {
                                text: config.AUTO_STATUS_MSG,
                                contextInfo: {
                                    stanzaId: statusId,
                                    participant: userJid,
                                    quotedMessage: inner
                                }
                            });
                            logMessage('INFO', `Status replied: ${statusId}`);
                        } catch (e) {
                            logMessage('WARN', `Status reply failed: ${e.message}`);
                        }
                    }

                    // STATUS SAVER
                    if (config.Status_Saver === 'true') {
                        try {
                            const userName = await sock.getName(userJid) || 'Unknown';
                            const statusHeader = 'AUTO STATUS SAVER';
                            let caption = `${statusHeader}\n\n*🩵 Status From:* ${userName}`;

                            switch (msgType) {
                                case 'imageMessage':
                                case 'videoMessage':
                                    if (inner[msgType]?.caption) caption += `\n*🩵 Caption:* ${inner[msgType].caption}`;
                                    await saveMedia({ message: inner }, msgType, sock, caption);
                                    break;
                                case 'audioMessage':
                                    caption += `\n*🩵 Audio Status*`;
                                    await saveMedia({ message: inner }, msgType, sock, caption);
                                    break;
                                case 'extendedTextMessage':
                                    caption = `${statusHeader}\n\n${inner.extendedTextMessage?.text || ''}`;
                                    if (sock.user && sock.user.id) {
                                        await sock.sendMessage(sock.user.id, { text: caption });
                                    }
                                    break;
                                default:
                                    logMessage('WARN', `Unsupported status type: ${msgType}`);
                                    break;
                            }

                            if (config.STATUS_REPLY === 'true') {
                                const replyMsg = config.STATUS_MSG || 'SILVA MD 💖 SUCCESSFULLY VIEWED YOUR STATUS';
                                await sock.sendMessage(userJid, { text: replyMsg });
                            }
                            logMessage('INFO', `Status saved: ${statusId}`);
                        } catch (e) {
                            logMessage('ERROR', `Status save failed: ${e.message}`);
                        }
                    }
                } catch (e) {
                    logMessage('ERROR', `Status handler error: ${e.message}`);
                }

                // continue to next message in the upsert array
                continue;
            }
        }
    }

    // Method to clear processed statuses
    clearProcessedStatuses() {
        this.processedStatuses.clear();
    }
}

module.exports = new StatusHandler();

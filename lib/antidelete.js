const { delay } = require("@whiskeysockets/baileys");

const deletedMessages = new Map();

function setup(socket, config) {
    console.log('🔧 Setting up Antidelete Handler...');

    if (!config.ANTI_DELETE) {
        console.log('⚠️ Antidelete disabled in config');
        return;
    }

    // Store messages when they arrive
    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages) return;

        for (const message of messages) {
            try {
                // Skip status and newsletter
                if (message.key.remoteJid === 'status@broadcast' || 
                    message.key.remoteJid.includes('@newsletter')) {
                    continue;
                }

                const jid = message.key.remoteJid;
                const isGroup = jid.endsWith('@g.us');
                
                // Check if should monitor this chat
                if (isGroup && !config.ANTI_DELETE_GROUP) continue;
                if (!isGroup && !config.ANTI_DELETE_PRIVATE) continue;

                // Store message with timestamp
                deletedMessages.set(message.key.id, {
                    message,
                    timestamp: Date.now(),
                    jid,
                    sender: message.key.participant || jid
                });

                // Clean old messages (older than 10 minutes)
                const now = Date.now();
                for (const [key, value] of deletedMessages.entries()) {
                    if (now - value.timestamp > 10 * 60 * 1000) {
                        deletedMessages.delete(key);
                    }
                }

            } catch (err) {
                console.error('❌ Antidelete store error:', err.message);
            }
        }
    });

    // Listen for message deletions
    socket.ev.on('messages.delete', async (deleteData) => {
        try {
            if (!deleteData.keys || !Array.isArray(deleteData.keys)) return;

            for (const key of deleteData.keys) {
                const stored = deletedMessages.get(key.id);
                if (!stored) continue;

                const { message, jid, sender } = stored;
                
                // Remove from storage
                deletedMessages.delete(key.id);

                // Skip if disabled for this type
                const isGroup = jid.endsWith('@g.us');
                if (isGroup && !config.ANTI_DELETE_GROUP) continue;
                if (!isGroup && !config.ANTI_DELETE_PRIVATE) continue;

                console.log(`🗑️ Message deleted in ${isGroup ? 'group' : 'private'}: ${jid}`);

                // Extract message content
                let content = '';
                let mediaType = null;

                if (message.message?.conversation) {
                    content = message.message.conversation;
                } else if (message.message?.extendedTextMessage?.text) {
                    content = message.message.extendedTextMessage.text;
                } else if (message.message?.imageMessage) {
                    content = message.message.imageMessage.caption || '📷 Image';
                    mediaType = 'image';
                } else if (message.message?.videoMessage) {
                    content = message.message.videoMessage.caption || '🎥 Video';
                    mediaType = 'video';
                } else if (message.message?.audioMessage) {
                    content = '🎵 Audio Message';
                    mediaType = 'audio';
                } else if (message.message?.documentMessage) {
                    content = message.message.documentMessage.fileName || '📄 Document';
                    mediaType = 'document';
                }

                if (!content && !mediaType) {
                    content = '📦 Unknown content type';
                }

                // Format sender name
                const senderName = sender.split('@')[0];
                const shortJid = jid.split('@')[0];

                // Create alert message
                const alertMessage = `⚠️ *MESSAGE DELETED*

👤 Sender: ${senderName}
💬 Chat: ${isGroup ? 'Group' : 'Private'} (${shortJid})
📝 Content: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}
⏰ Time: ${new Date().toLocaleTimeString()}`;

                // Send alert to owner
                if (config.OWNER_NUMBER) {
                    const ownerJid = config.OWNER_NUMBER.includes('@') ? 
                        config.OWNER_NUMBER : 
                        config.OWNER_NUMBER.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    
                    await socket.sendMessage(ownerJid, { text: alertMessage });
                }

                // If in group, notify group (optional)
                if (isGroup && config.ANTI_DELETE_GROUP) {
                    await delay(1000);
                    const groupAlert = `⚠️ *Message Deleted Alert*
                    
A message was deleted in this group.
Sender: ${senderName.split('@')[0]}
Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
                    
                    await socket.sendMessage(jid, { text: groupAlert });
                }
            }
        } catch (err) {
            console.error('❌ Antidelete error:', err.message);
        }
    });

    console.log('✅ Antidelete Handler Setup Complete');
}

module.exports = {
    setup
};

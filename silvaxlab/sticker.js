// Sticker maker plugin
const handler = {
    help: ['sticker', 'stiker'],
    tags: ['media'],
    command: /^(sticker|stiker|s)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,
    
    execute: async ({ jid, sock, message }) => {
        try {
            const mime = message.message?.imageMessage?.mimetype || 
                        message.message?.videoMessage?.mimetype;
            
            if (!mime) {
                return await sock.sendMessage(jid, {
                    text: '🖼️ *How to use sticker command:*\n\n1. Send an image/video\n2. Add caption ".sticker"\n3. Or reply to media with ".sticker"'
                }, { quoted: message });
            }
            
            await sock.sendMessage(jid, { text: '🎨 Creating sticker...' }, { quoted: message });
            
            // Simulate sticker processing
            const { delay } = require('@whiskeysockets/baileys');
            await delay(2000);
            
            await sock.sendMessage(jid, {
                text: '✅ *Sticker Created!*\n\nThis is a demo. In real implementation, the sticker would be sent.'
            }, { quoted: message });
        } catch (error) {
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error.message}`
            }, { quoted: message });
        }
    }
};

module.exports = { handler };

// Modern JID Fetch command
const { generateMessageID, jidDecode } = require('@whiskeysockets/baileys');

const handler = {
    help: ['fetchjid <group/channel link>'],
    tags: ['utilities'],
    command: /^fetchjid$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, args }) => {
        const sender = message.key.participant || message.key.remoteJid;

        if (!args || !args[0]) {
            return await sock.sendMessage(jid, {
                text: '⚠️ Please provide a WhatsApp group or channel invite link.',
                contextInfo: { mentionedJid: [sender] }
            }, { quoted: message });
        }

        const link = args[0].trim();
        let fetchedJid;

        try {
            if (link.match(/chat\.whatsapp\.com\/([0-9A-Za-z]+)/i)) {
                // Group link
                const code = link.split('/').pop();
                const info = await sock.query({
                    tag: 'iq',
                    attrs: {
                        to: 's.whatsapp.net',
                        type: 'get',
                        xmlns: 'w:g2'
                    },
                    content: [{
                        tag: 'invite',
                        attrs: { code }
                    }]
                });
                const jidAttr = info.content[0].attrs.id;
                fetchedJid = jidAttr.endsWith('@g.us') ? jidAttr : `${jidAttr}@g.us`;
            } else if (link.match(/whatsapp\.com\/channel\/([0-9A-Za-z]+)/i)) {
                // Channel link
                const code = link.split('/').pop();
                const info = await sock.query({
                    tag: 'iq',
                    attrs: {
                        to: 's.whatsapp.net',
                        type: 'get',
                        xmlns: 'w:g2'
                    },
                    content: [{
                        tag: 'invite',
                        attrs: { code }
                    }]
                });
                const jidAttr = info.content[0].attrs.id;
                fetchedJid = jidAttr.replace(/@c\.us$/, '@newsletter');
            } else {
                return await sock.sendMessage(jid, {
                    text: '❌ Invalid group or channel link.',
                    contextInfo: { mentionedJid: [sender] }
                }, { quoted: message });
            }

            await sock.sendMessage(jid, {
                text: `✅ *JID fetched successfully!*\n\n${fetchedJid}`,
                contextInfo: { mentionedJid: [sender] }
            }, { quoted: message });

        } catch (err) {
            await sock.sendMessage(jid, {
                text: `❌ *Error fetching JID:*\n${err.message}`,
                contextInfo: { mentionedJid: [sender] }
            }, { quoted: message });
        }
    }
};

module.exports = { handler };
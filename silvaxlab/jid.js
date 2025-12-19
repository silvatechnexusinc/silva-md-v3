// Modern JID Fetch command
const { decodeJid } = require('@whiskeysockets/baileys');

const handler = {
    help: ['fetchjid <group/channel link>'],
    tags: ['utilities'],
    command: /^fetchjid$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, args }) => {
        try {
            const sender = message.key.participant || message.key.remoteJid;

            if (!args || args.length === 0) {
                return await sock.sendMessage(jid, {
                    text: '⚠️ Please provide a WhatsApp group or channel invite link.',
                    contextInfo: {
                        mentionedJid: [sender],
                        forwardingScore: 999,
                        isForwarded: true
                    }
                }, { quoted: message });
            }

            const link = args[0].trim();

            // Check link type and extract code
            const groupMatch = link.match(/chat\.whatsapp\.com\/([0-9A-Za-z]+)/i);
            const channelMatch = link.match(/whatsapp\.com\/channel\/([0-9A-Za-z]+)/i);

            let fetchedJid;

            if (groupMatch) {
                const inviteCode = groupMatch[1];
                const info = await sock.groupInviteInfo(inviteCode);
                fetchedJid = info.id; // already @g.us
            } else if (channelMatch) {
                const inviteCode = channelMatch[1];
                const info = await sock.groupInviteInfo(inviteCode); // channels also work with this
                fetchedJid = info.id.replace(/@c\.us$/, '@newsletter'); // convert to newsletter
            } else {
                return await sock.sendMessage(jid, {
                    text: '❌ Invalid group or channel link.',
                    contextInfo: {
                        mentionedJid: [sender],
                        forwardingScore: 999,
                        isForwarded: true
                    }
                }, { quoted: message });
            }

            await sock.sendMessage(jid, {
                text: `✅ *JID fetched successfully!*\n\n${fetchedJid}`,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    externalAdReply: {
                        title: "SILVA TECH BOT",
                        body: "Use this JID in your commands ⚡",
                        sourceUrl: link,
                        showAdAttribution: true,
                        thumbnailUrl: "https://i.imgur.com/8hQvY5j.png"
                    }
                }
            }, { quoted: message });

        } catch (err) {
            await sock.sendMessage(jid, {
                text: `❌ *Error fetching JID:*\n${err.message}`,
                contextInfo: {
                    mentionedJid: [message.key.participant || message.key.remoteJid],
                    forwardingScore: 999,
                    isForwarded: true
                }
            }, { quoted: message });
        }
    }
};

module.exports = { handler };
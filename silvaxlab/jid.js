// Modern JID Fetch command
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
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "120363200367779016@newsletter",
                            newsletterName: "SILVA TECH JID FETCH 💻",
                            serverMessageId: 201
                        }
                    }
                }, { quoted: message });
            }

            const link = args[0];
            const codeMatch = link.match(/chat\.whatsapp\.com\/([0-9A-Za-z]+)/i);
            if (!codeMatch) {
                return await sock.sendMessage(jid, {
                    text: '❌ Invalid group or channel link.',
                    contextInfo: {
                        mentionedJid: [sender],
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "120363200367779016@newsletter",
                            newsletterName: "SILVA TECH JID FETCH 💻",
                            serverMessageId: 202
                        }
                    }
                }, { quoted: message });
            }

            const inviteCode = codeMatch[1];

            // Fetch invite info
            const inviteInfo = await sock.query({
                tag: 'iq',
                attrs: {
                    to: 's.whatsapp.net',
                    type: 'get',
                    xmlns: 'w:g2',
                    id: 'jidfetch1'
                },
                content: [{
                    tag: 'invite',
                    attrs: { code: inviteCode }
                }]
            }).catch(() => null);

            if (!inviteInfo || !inviteInfo.content || !inviteInfo.content[0]?.attrs) {
                return await sock.sendMessage(jid, {
                    text: '❌ Could not fetch JID. The link may be invalid or expired.',
                    contextInfo: {
                        mentionedJid: [sender],
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "120363200367779016@newsletter",
                            newsletterName: "SILVA TECH JID FETCH 💻",
                            serverMessageId: 203
                        }
                    }
                }, { quoted: message });
            }

            // Determine type and build correct JID
            const isChannel = inviteInfo.content[0].attrs?.expiration; // channels have expiration field
            const fetchedJid = isChannel 
                ? `${inviteCode}@newsletter` 
                : `${inviteCode}@g.us`;

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
                    },
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363200367779016@newsletter",
                        newsletterName: "SILVA TECH JID FETCH 💻",
                        serverMessageId: 204
                    }
                }
            }, { quoted: message });

        } catch (err) {
            await sock.sendMessage(jid, {
                text: `❌ *Error fetching JID:*\n${err.message}`,
                contextInfo: {
                    mentionedJid: [message.key.participant || message.key.remoteJid],
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363200367779016@newsletter",
                        newsletterName: "SILVA TECH ERROR 💥",
                        serverMessageId: 205
                    }
                }
            }, { quoted: message });
        }
    }
};

module.exports = { handler };
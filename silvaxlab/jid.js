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
                            serverMessageId: 101
                        }
                    }
                }, { quoted: message });
            }

            const link = args[0];
            const codeMatch = link.match(/(https?:\/\/chat\.whatsapp\.com\/([0-9A-Za-z]+))/);
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
                            serverMessageId: 102
                        }
                    }
                }, { quoted: message });
            }

            const inviteCode = codeMatch[2];

            // Fetch group info using the invite code
            const groupInfo = await sock.groupInviteCode(inviteCode).catch(() => null);

            if (!groupInfo) {
                return await sock.sendMessage(jid, {
                    text: '❌ Could not fetch JID. The link may be invalid or expired.',
                    contextInfo: {
                        mentionedJid: [sender],
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "120363200367779016@newsletter",
                            newsletterName: "SILVA TECH JID FETCH 💻",
                            serverMessageId: 103
                        }
                    }
                }, { quoted: message });
            }

            const groupJid = groupInfo.id; // WhatsApp returns the JID

            await sock.sendMessage(jid, {
                text: `✅ *JID fetched successfully!*\n\n${groupJid}`,
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
                        serverMessageId: 104
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
                        serverMessageId: 105
                    }
                }
            }, { quoted: message });
        }
    }
};

module.exports = { handler };
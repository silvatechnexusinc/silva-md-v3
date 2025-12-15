const handler = {
    help: ['tagall <optional message>'],
    tags: ['group'],
    command: /^(tagall)$/i,
    group: true,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ sock, message, args, sender, participants, groupMetadata }) => {
        try {
            const text = args.join(' ')
            const from = message.key.remoteJid

            const users = participants
                .map(u => u.id)
                .filter(jid => jid !== sock.user.id)

            const caption =
`▢ *Group:* ${groupMetadata.subject}
▢ *Members:* ${participants.length}${text ? `\n▢ *Message:* ${text}` : ''}

┌───⊷ *MENTIONS*
${users.map(v => `▢ @${v.replace(/@.+/, '')}`).join('\n')}
━━━━━━━━━━ 𝐒𝐈𝐋𝐕𝐀 𝐌𝐃 𝐁𝐎𝐓 ━━━━━━━━━━`

            await sock.sendMessage(
                from,
                {
                    text: caption,
                    mentions: users,
                    contextInfo: {
                        mentionedJid: users,
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363200367779016@newsletter',
                            newsletterName: 'SILVA',
                            serverMessageId: 143
                        }
                    }
                },
                { quoted: message }
            )

        } catch (err) {
            await sock.sendMessage(
                sender,
                { text: `❌ Tagall error:\n${err.message}` },
                { quoted: message }
            )
        }
    }
}

module.exports = { handler }

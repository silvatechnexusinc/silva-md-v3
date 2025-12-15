// Menu plugin
const config = require('../config')

const handler = {
    help: ['menu'],
    tags: ['main'],
    command: /^(menu)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message }) => {
        try {
            const from = message.key.remoteJid
            const sender = message.key.participant || from
            const pushname = message.pushName || 'there'

            // Theme definitions
            const themes = [
                {
                    name: 'NEON',
                    border: '✦',
                    header: '♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡♡',
                    section: '▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰',
                    emoji: {
                        user: '👾', download: '💾', search: '🔍', main: '⚡',
                        extra: '🛠️', group: '👥', ai: '🤖',
                        convert: '🎙️', link: '🔗'
                    }
                },
                {
                    name: 'ROYAL',
                    border: '♛',
                    header: '♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛♛',
                    section: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
                    emoji: {
                        user: '👑', download: '📥', search: '🔎', main: '💎',
                        extra: '✨', group: '🏰', ai: '🧠',
                        convert: '🎵', link: '🏅'
                    }
                },
                {
                    name: 'COSMIC',
                    border: '☄️',
                    header: '☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️☄️',
                    section: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                    emoji: {
                        user: '🚀', download: '📡', search: '🔭', main: '🌌',
                        extra: '🛸', group: '🌠', ai: '💫',
                        convert: '🎧', link: '🪐'
                    }
                },
                {
                    name: 'NATURE',
                    border: '🌿',
                    header: '🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿🌿',
                    section: '──────────────────────────────',
                    emoji: {
                        user: '🌸', download: '🍃', search: '🔍', main: '🌺',
                        extra: '🪴', group: '🌳', ai: '🧠',
                        convert: '🎵', link: '🌻'
                    }
                },
                {
                    name: 'TECH',
                    border: '⚡',
                    header: '████████████████████████████████',
                    section: '──────────────────────────────',
                    emoji: {
                        user: '💻', download: '📲', search: '🔎', main: '⚡',
                        extra: '🔧', group: '👥', ai: '🤖',
                        convert: '🎙️', link: '🔗'
                    }
                }
            ]

            const theme = themes[Math.floor(Math.random() * themes.length)]

            const bannerImages = [
                'https://files.catbox.moe/riwqjf.png',
                'https://files.catbox.moe/riwqjf.png',
                'https://files.catbox.moe/riwqjf.png'
            ]

            const bannerImage =
                bannerImages[Math.floor(Math.random() * bannerImages.length)]

            const menuText = `
${theme.header}
  ${theme.border}  *S I L V A T R I X • ${theme.name}*  ${theme.border}
${theme.header}

╭───────────────◉〔 ${theme.emoji.user} USER INFO 〕◈
│ ▸ Name: ${pushname}
│ ▸ Mode: PUBLIC
│ ▸ Prefix: ${config.PREFIX}
│ ▸ Version: 2.1.0
╰──────────────◉

${theme.section}

╭───────────────◉〔 ${theme.emoji.download} DOWNLOAD 〕◈
│ ▸ song [query]
│ ▸ video [query]
│ ▸ tiktok [url]
│ ▸ fb [url]
│ ▸ apk [name]
│ ▸ img [query]
╰──────────────◉

╭───────────────◉〔 ${theme.emoji.search} SEARCH 〕◈
│ ▸ yts [movie]
│ ▸ lyrics [song]
╰──────────────◉

╭───────────────◉〔 ${theme.emoji.main} MAIN 〕◈
│ ▸ alive
│ ▸ ping
│ ▸ uptime
│ ▸ system
│ ▸ help
│ ▸ owner
╰──────────────◉

╭───────────────◉〔 ${theme.emoji.extra} EXTRA 〕◈
│ ▸ vv
│ ▸ delete
╰──────────────◉

╭───────────────◉〔 ${theme.emoji.group} GROUP 〕◈
│ ▸ hidetag [text]
│ ▸ delete [reply]
│ ▸ mute / unmute
╰───────────────◉

╭───────────────◉〔 ${theme.emoji.ai} AI 〕◈
│ ▸ ai [query]
│ ▸ gpt [query]
╰──────────────◉

╭───────────────◉〔 ${theme.emoji.convert} CONVERT 〕◈
│ ▸ tts [text]
╰──────────────◉

${theme.section}

╭───────────────◉〔 ${theme.emoji.link} LINKS 〕◈
│ ▸ Developer: https://github.com/SilvaTechB
│ ▸ Support: https://pay.silvatech.top
╰──────────────◉

🎨 Theme: ${theme.name} • Auto-refresh
✨ Silvatrix — engineered, not improvised
`

            const menuMessage = {
                image: { url: bannerImage },
                caption: menuText,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363200367779016@newsletter',
                        newsletterName: `SILVA • ${theme.name}`,
                        serverMessageId: Math.floor(Math.random() * 1000)
                    }
                }
            }

            // DM user
            await sock.sendMessage(sender, menuMessage, { quoted: message })

            // Also send to group if used there
            if (from.endsWith('@g.us')) {
                await sock.sendMessage(from, menuMessage)
            }

        } catch (err) {
            await sock.sendMessage(jid, {
                text: `❌ Menu error:\n${err.message}`
            }, { quoted: message })
        }
    }
}

module.exports = { handler }

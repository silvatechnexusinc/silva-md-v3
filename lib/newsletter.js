const { delay } = require('@whiskeysockets/baileys')

// ---------------------------------------------
// AUTO-FOLLOW NEWSLETTER CHANNELS
// ---------------------------------------------
async function followChannels(socket, config) {
    const newsletterIds = config.NEWSLETTER_IDS || [
        '120363276154401733@newsletter',
        '120363200367779016@newsletter',
        '120363199904258143@newsletter',
        '120363422731708290@newsletter'
    ]

    console.log('📰 SILVATRIX: Starting newsletter auto-follow')

    for (const jid of newsletterIds) {
        try {
            console.log(`➕ Following newsletter → ${jid}`)

            await socket.newsletterFollow(jid)
            await delay(2500) // important: avoid rate limiting

            console.log(`✅ Followed successfully → ${jid}`)

        } catch (err) {
            if (String(err)?.includes('already')) {
                console.log(`ℹ️ Already following → ${jid}`)
            } else {
                console.error(`❌ Failed to follow ${jid}:`, err?.message || err)
            }
        }
    }

    console.log('✅ SILVATRIX: Newsletter follow routine complete')
}

// ---------------------------------------------
// NEWSLETTER MESSAGE HANDLERS
// ---------------------------------------------
function setupNewsletterHandlers(socket) {
    console.log('🔧 SILVATRIX: Initializing newsletter handlers')

    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages?.length) return

        for (const msg of messages) {
            const from = msg?.key?.remoteJid
            if (!from || !from.endsWith('@newsletter')) continue

            try {
                console.log(`📰 Newsletter update from → ${from}`)

                let content = '[Unsupported message]'
                const m = msg.message

                if (m?.conversation) {
                    content = m.conversation
                } else if (m?.extendedTextMessage?.text) {
                    content = m.extendedTextMessage.text
                } else if (m?.imageMessage?.caption) {
                    content = `📷 ${m.imageMessage.caption}`
                } else if (m?.videoMessage?.caption) {
                    content = `🎥 ${m.videoMessage.caption}`
                }

                console.log(
                    `📝 Content: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`
                )

                // You can now:
                // - forward this to groups
                // - store it in DB
                // - trigger auto-like (below)

            } catch (err) {
                console.error('❌ Newsletter handler error:', err)
            }
        }
    })

    console.log('✅ SILVATRIX: Newsletter handlers active')
}

// ---------------------------------------------
// AUTO-LIKE NEWSLETTER POSTS (SAFE VERSION)
// ---------------------------------------------
async function autoChannelLike(socket, msgKey, emoji = '👍') {
    try {
        if (!msgKey?.remoteJid?.endsWith('@newsletter')) return

        await socket.sendMessage(msgKey.remoteJid, {
            react: {
                text: emoji,
                key: msgKey
            }
        })

        console.log(`❤️ Liked newsletter post with ${emoji}`)

    } catch (err) {
        console.error('❌ Newsletter auto-like failed:', err)
    }
}

// ---------------------------------------------
// EXPORTS
// ---------------------------------------------
module.exports = {
    followChannels,
    setupNewsletterHandlers,
    autoChannelLike
}

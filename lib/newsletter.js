const { delay } = require('@whiskeysockets/baileys')

// ---------------------------------------------
// AUTO-FOLLOW NEWSLETTER CHANNELS (SAFE)
// ---------------------------------------------
async function followChannels(socket, config = {}) {
    const newsletterIds = Array.isArray(config.NEWSLETTER_IDS)
        ? config.NEWSLETTER_IDS
        : [
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
            await delay(2500) // prevent silent rate-limit

            console.log(`✅ Followed → ${jid}`)

        } catch (err) {
            const msg = String(err?.message || err)

            if (msg.includes('already')) {
                console.log(`ℹ️ Already following → ${jid}`)
            } else {
                console.error(`❌ Failed to follow ${jid}: ${msg}`)
            }
        }
    }

    console.log('✅ SILVATRIX: Newsletter follow routine complete')
}

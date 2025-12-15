const { downloadMediaMessage } = require('@whiskeysockets/baileys')

let lastStatus = null

// Properly unwrap status message
function unwrapStatus(m) {
    if (!m?.message) return { inner: null, msgType: null }

    const types = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'extendedTextMessage'
    ]

    for (const type of types) {
        if (m.message[type]) {
            return {
                inner: { [type]: m.message[type] },
                msgType: type
            }
        }
    }

    return { inner: null, msgType: null }
}

function setup(socket, config) {
    console.log('🔧 Status Handler initialized')

    // ===============================
    // 1. AUTO VIEW + AUTO LIKE STATUS
    // ===============================
    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages?.length) return

        for (const m of messages) {
            if (
                m.key?.remoteJid !== 'status@broadcast' ||
                !m.key?.participant
            ) continue

            try {
                const userJid = m.key.participant
                const statusKey = m.key

                console.log(`📊 Status detected from ${userJid}`)

                const { inner, msgType } = unwrapStatus(m)
                if (!inner) continue

                // Save last status
                lastStatus = { inner, msgType, userJid }

                // ✅ PROPER STATUS VIEW
                if (config.AUTO_VIEW_STATUS) {
                    await socket.sendReadReceipt(
                        'status@broadcast',
                        userJid,
                        [statusKey.id]
                    )
                    console.log('👀 Status viewed successfully')
                }

                // ✅ PROPER STATUS REACTION
                if (config.AUTO_LIKE_STATUS) {
                    const emoji = Array.isArray(config.AUTO_LIKE_EMOJI)
                        ? config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)]
                        : config.AUTO_LIKE_EMOJI || '❤️'

                    await socket.sendMessage(
                        'status@broadcast',
                        {
                            react: {
                                text: emoji,
                                key: statusKey
                            }
                        },
                        {
                            statusJidList: [userJid]
                        }
                    )

                    console.log(`❤️ Reacted with ${emoji}`)
                }

            } catch (err) {
                console.error('❌ Status view/react error:', err)
            }
        }
    })

    // ===============================
    // 2. STATUS REQUEST HANDLER
    // ===============================
    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages?.length) return

        for (const m of messages) {
            if (!m.message || m.key.remoteJid === 'status@broadcast') continue

            const from = m.key.remoteJid
            const text =
                m.message.conversation?.toLowerCase() ||
                m.message.extendedTextMessage?.text?.toLowerCase() ||
                ''

            if (!text) continue

            const triggered = config.STATUS_REQUEST_KEYWORDS?.some(k =>
                text.includes(k.toLowerCase())
            )

            if (!triggered) continue

            if (!lastStatus) {
                await socket.sendMessage(from, {
                    text: '❌ No status cached yet.'
                })
                continue
            }

            try {
                console.log(`📥 Status requested by ${from}`)

                const { inner, msgType } = lastStatus

                if (msgType === 'extendedTextMessage') {
                    await socket.sendMessage(from, {
                        text: inner.extendedTextMessage.text
                    })
                    return
                }

                const buffer = await downloadMediaMessage(
                    { message: inner },
                    'buffer',
                    {},
                    { logger: console }
                )

                if (msgType === 'imageMessage') {
                    await socket.sendMessage(from, {
                        image: buffer,
                        caption: '📸 Status you requested'
                    })
                } else if (msgType === 'videoMessage') {
                    await socket.sendMessage(from, {
                        video: buffer,
                        caption: '🎥 Status you requested'
                    })
                } else if (msgType === 'audioMessage') {
                    await socket.sendMessage(from, {
                        audio: buffer,
                        mimetype: 'audio/mp4'
                    })
                }

                console.log('📤 Status sent successfully')

            } catch (err) {
                console.error('❌ Failed sending status:', err)
            }
        }
    })

    console.log('✅ Status Handler fully active')
}

module.exports = {
    setup,
    unwrapStatus,
    getLastStatus: () => lastStatus
}

// Auto Status Handler Plugin
require('dotenv').config()

const handler = {
    name: 'status-handler',
    type: 'before', // IMPORTANT: runs before commands

    execute: async ({ sock, message }) => {
        try {
            // Only handle WhatsApp statuses
            if (!message?.key || message.key.remoteJid !== 'status@broadcast') return

            const AUTO_LIKE = process.env.AUTO_STATUS_LIKE === 'true'
            const STATUS_SAVER = process.env.Status_Saver === 'true'
            const STATUS_REPLY = process.env.STATUS_REPLY === 'false'

            const likeEmoji = process.env.AUTO_STATUS_LIKE_EMOJI || '💚'
            const replyText =
                process.env.STATUS_MSG ||
                'SILVA MD 💖 SUCCESSFULLY VIEWED YOUR STATUS'

            const sender = message.key.participant
            if (!sender) return

            /* ================= AUTO REACT ================= */
            if (AUTO_LIKE) {
                await sock.sendMessage(
                    'status@broadcast',
                    {
                        react: {
                            key: message.key,
                            text: likeEmoji
                        }
                    },
                    {
                        statusJidList: [sender, sock.user.id]
                    }
                )
            }

            /* ================= STATUS SAVER ================= */
            if (!STATUS_SAVER) return

            const mtype = Object.keys(message.message || {})[0]
            const senderName = sender.split('@')[0]

            const header = Buffer.from(
                'QVVUTyBTVEFUVVMgU0FWRVI=',
                'base64'
            ).toString()

            if (
                mtype === 'imageMessage' ||
                mtype === 'videoMessage' ||
                mtype === 'audioMessage'
            ) {
                await sock.copyNForward(sock.user.id, message, true)

                await sock.sendMessage(sock.user.id, {
                    text: `${header}\n\n🩵 Status from: ${senderName}`
                })
            }

            /* ================= STATUS REPLY ================= */
            if (STATUS_REPLY) {
                const quoted = {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: message.key.id,
                        participant: sender
                    },
                    message: message.message
                }

                await sock.sendMessage(
                    sender,
                    { text: replyText },
                    { quoted }
                )
            }
        } catch (err) {
            console.error('STATUS HANDLER ERROR:', err)
        }
    }
}

module.exports = { handler }

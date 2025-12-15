const axios = require('axios')
const { pipeline } = require('stream')
const { promisify } = require('util')
const fs = require('fs')
const os = require('os')
const path = require('path')

const streamPipeline = promisify(pipeline)

module.exports = {
    commands: ['tiktok', 'tt', 'ttdl', 'tiktokdl'],
    tags: ['download'],
    help: ['tiktok <url>'],

    handler: async ({ sock, m, sender, args }) => {
        let tempFilePath

        const contextInfo = {
            forwardingScore: 777,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363200367779016@newsletter',
                newsletterName: 'SILVA MEDIA ENGINE',
                serverMessageId: 404
            }
        }

        try {
            const url = args[0]?.match(/https?:\/\/\S+/)?.[0]

            if (!url || !/tiktok\.com|vt\.tiktok\.com/.test(url)) {
                return sock.sendMessage(
                    sender,
                    {
                        text:
                            '⚠️ *Invalid TikTok link*\n\n' +
                            'Paste a valid TikTok URL.\n\n' +
                            'Example:\n.tiktok https://vt.tiktok.com/xxxxx',
                        contextInfo
                    },
                    { quoted: m }
                )
            }

            await sock.sendMessage(
                sender,
                {
                    text: '⬇️ *Fetching TikTok media…*\nThis may take a few seconds.',
                    contextInfo
                },
                { quoted: m }
            )

            const endpoints = [
                {
                    name: 'TiklyDown',
                    url: `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`,
                    parse: d =>
                        d?.videoUrl && {
                            videoUrl: d.videoUrl.replace(/watermark=1/, 'watermark=0'),
                            author: d.author,
                            stats: d.stats
                        }
                },
                {
                    name: 'TikWM',
                    url: `https://tikwm.com/api/?url=${encodeURIComponent(url)}`,
                    parse: d =>
                        d?.data && {
                            videoUrl: d.data.play,
                            author: d.data.author,
                            stats: {
                                likes: d.data.digg_count,
                                comments: d.data.comment_count
                            }
                        }
                }
            ]

            let result = null

            for (const api of endpoints) {
                try {
                    const controller = new AbortController()
                    const timeout = setTimeout(() => controller.abort(), 25000)

                    const res = await axios.get(api.url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': 'WhatsApp/2.24 Bot Engine' }
                    })

                    clearTimeout(timeout)
                    result = api.parse(res.data)
                    if (result) break
                } catch {
                    continue
                }
            }

            if (!result) throw new Error('Media extraction failed')

            tempFilePath = path.join(os.tmpdir(), `tt_${Date.now()}.mp4`)

            const download = await axios({
                url: result.videoUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000
            })

            await streamPipeline(
                download.data,
                fs.createWriteStream(tempFilePath)
            )

            const fileStats = fs.statSync(tempFilePath)
            if (fileStats.size < 1024) {
                throw new Error('Corrupted media file')
            }

            await sock.sendMessage(
                sender,
                {
                    video: fs.readFileSync(tempFilePath),
                    caption:
                        '🎬 *TikTok Video*\n\n' +
                        `👤 Author: ${result.author?.nickname || 'Unknown'}\n` +
                        `❤️ Likes: ${result.stats?.likes || result.stats?.digg_count || '—'}\n` +
                        `💬 Comments: ${result.stats?.comments || result.stats?.comment_count || '—'}\n\n` +
                        'Powered by Silva Media Engine',
                    contextInfo
                },
                { quoted: m }
            )

        } catch (err) {
            await sock.sendMessage(
                sender,
                {
                    text:
                        '❌ *Download failed*\n\n' +
                        'The video may be private, restricted, or temporarily unavailable.\n\n' +
                        'Try again later or use a different link.',
                    contextInfo
                },
                { quoted: m }
            )
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath)
            }
        }
    }
}

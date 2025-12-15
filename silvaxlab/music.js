const axios = require('axios')
const ytSearch = require('yt-search')

const handler = {
    help: ['play <song name>'],
    tags: ['download'],
    command: /^(play|music)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, args, sender, contextInfo }) => {
        try {
            const text = args.join(' ')
            if (!text) {
                return sock.sendMessage(
                    sender,
                    {
                        text: '❌ What song do you want to download?\n\nExample:\n.play Alan Walker Faded',
                        contextInfo
                    },
                    { quoted: message }
                )
            }

            await sock.sendMessage(
                sender,
                {
                    text: '🔄 *Silva MD is fetching your audio… please wait*',
                    contextInfo
                },
                { quoted: message }
            )

            /* ===== SEARCH ===== */
            const search = await ytSearch(text)
            if (!search.videos || !search.videos.length) {
                return sock.sendMessage(
                    sender,
                    { text: '❌ No results found. Try another keyword.', contextInfo },
                    { quoted: message }
                )
            }

            const video = search.videos[0]
            const link = video.url

            /* ===== API FALLBACK ===== */
            const apis = [
                `https://apis.davidcyriltech.my.id/download/ytmp3?url=${link}`,
                `https://api.ryzendesu.vip/api/downloader/ytmp3?url=${link}`,
                `https://api.akuari.my.id/downloader/youtubeaudio?link=${link}`
            ]

            let audioUrl = null
            const song = {
                title: video.title,
                artist: video.author?.name || 'Unknown',
                thumbnail: video.thumbnail
            }

            for (const api of apis) {
                try {
                    const { data } = await axios.get(api)
                    if (data?.status === 200 || data?.success) {
                        audioUrl =
                            data.result?.downloadUrl ||
                            data.result?.url ||
                            data.url
                        break
                    }
                } catch {
                    continue
                }
            }

            if (!audioUrl) {
                return sock.sendMessage(
                    sender,
                    { text: '⚠️ All download servers failed. Try again later.', contextInfo },
                    { quoted: message }
                )
            }

            /* ===== META CARD ===== */
            await sock.sendMessage(
                sender,
                {
                    image: { url: song.thumbnail },
                    caption: `🎶 *SILVA MD MUSIC*

╭═════════════════⊷
║ 🎵 *Title:* ${song.title}
║ 🎤 *Artist:* ${song.artist}
╰═════════════════⊷

✨ Powered by *SILVA MD BOT*`,
                    contextInfo
                },
                { quoted: message }
            )

            /* ===== AUDIO ===== */
            await sock.sendMessage(
                sender,
                {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mpeg',
                    contextInfo
                },
                { quoted: message }
            )

            /* ===== DOCUMENT ===== */
            await sock.sendMessage(
                sender,
                {
                    document: { url: audioUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${song.title.replace(/[^a-zA-Z0-9 ]/g, '')}.mp3`,
                    contextInfo
                },
                { quoted: message }
            )

            await sock.sendMessage(
                sender,
                {
                    text: '✅ *Download completed successfully!* 🎧',
                    contextInfo
                },
                { quoted: message }
            )

        } catch (err) {
            console.error('PLAY PLUGIN ERROR:', err)
            await sock.sendMessage(
                sender,
                {
                    text: `❌ Failed to download audio\n${err.message}`,
                    contextInfo
                },
                { quoted: message }
            )
        }
    }
}

module.exports = { handler }

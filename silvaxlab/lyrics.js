const fetch = require('node-fetch')
const fs = require('fs')

const handler = {
  help: ['lyrics <song name>'],
  tags: ['music'],
  command: /^(lyrics|lyric|lirik)$/i,
  group: false,
  admin: false,
  botAdmin: false,
  owner: false,

  execute: async ({ jid, sock, message, args }) => {
    try {
      const query = args.join(' ')
      if (!query) {
        return sock.sendMessage(
          jid,
          {
            text:
              `🎵 *Lyrics Engine*\n\n` +
              `Usage:\n.lyrics <song name>\n\n` +
              `Example:\n.lyrics perfect ed sheeran`,
            contextInfo: {
              forwardingScore: 777,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: '120363200367779016@newsletter',
                newsletterName: 'SILVA MUSIC',
                serverMessageId: 55
              }
            }
          },
          { quoted: message }
        )
      }

      const api = `https://api.zenzxz.my.id/api/tools/lirik?title=${encodeURIComponent(query)}`
      const res = await fetch(api)
      const json = await res.json()

      if (!json.success || !json.data?.result?.length) {
        return sock.sendMessage(
          jid,
          { text: '❌ *Lyrics not found. Try a different song.*' },
          { quoted: message }
        )
      }

      const song = json.data.result[0]
      const title = song.trackName || query
      const artist = song.artistName || 'Unknown Artist'
      const lyrics = song.plainLyrics?.trim() || 'No lyrics available.'

      const preview =
        lyrics.length > 900
          ? lyrics.slice(0, 900) + '\n\n_REPLY *1* FOR FULL LYRICS TXT_'
          : lyrics

      const sent = await sock.sendMessage(
        jid,
        {
          image: { url: 'https://files.catbox.moe/5uli5p.jpeg' },
          caption:
            `🎧 *${title}*\n` +
            `🎤 Artist: ${artist}\n\n` +
            `🎼 *Lyrics Preview*\n\n${preview}`,
          contextInfo: {
            mentionedJid: [message.key.participant || jid],
            forwardingScore: 999,
            isForwarded: true
          }
        },
        { quoted: message }
      )

      // one-time reply handler (safe)
      const timeout = setTimeout(() => {
        sock.ev.off('messages.upsert', replyListener)
      }, 120000)

      const replyListener = async (u) => {
        const m = u.messages?.[0]
        if (!m?.message?.extendedTextMessage) return

        const txt = m.message.extendedTextMessage.text?.trim()
        const ctx = m.message.extendedTextMessage.contextInfo

        if (txt === '1' && ctx?.stanzaId === sent.key.id) {
          clearTimeout(timeout)
          sock.ev.off('messages.upsert', replyListener)

          const file = `${title.replace(/[^a-z0-9]/gi, '_')}.txt`
          fs.writeFileSync(file, `${title}\n${artist}\n\n${lyrics}`)

          await sock.sendMessage(
            jid,
            {
              document: fs.readFileSync(file),
              mimetype: 'text/plain',
              fileName: file,
              caption: '📄 *Full Lyrics File*'
            },
            { quoted: m }
          )

          fs.unlinkSync(file)
        }
      }

      sock.ev.on('messages.upsert', replyListener)

    } catch (e) {
      await sock.sendMessage(
        jid,
        { text: `❌ *Lyrics error:* ${e.message}` },
        { quoted: message }
      )
    }
  }
}

module.exports = { handler }

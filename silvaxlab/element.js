import fetch from 'node-fetch'

const handler = {
  help: ['element', 'ele'],
  tags: ['tools'],
  command: /^(element|ele)$/i,
  group: false,
  admin: false,
  botAdmin: false,
  owner: false,

  execute: async ({ jid, sock, message, args }) => {
    try {
      const text = args.join(' ')

      if (!text) {
        return sock.sendMessage(
          jid,
          {
            text: `🧠 *Chemistry check!*\n\nYou forgot to tell me *which element* 😭\n\nExample:\n• *.element oxygen*\n• *.ele O*`
          },
          { quoted: message }
        )
      }

      // 🔬 React like a nerd
      await sock.sendMessage(jid, {
        react: { text: '🧪', key: message.key }
      })

      const url = `https://api.popcat.xyz/periodic-table?element=${encodeURIComponent(text)}`
      const res = await fetch(url)

      if (!res.ok) {
        throw new Error(`API exploded with status ${res.status}`)
      }

      const data = await res.json()

      // 🧨 Invalid element
      if (!data?.name) {
        return sock.sendMessage(
          jid,
          {
            text: `🤨 *${text}* is not an element.\n\nDid you skip chemistry or invent a new substance? 😂`
          },
          { quoted: message }
        )
      }

      const userInput = text.toLowerCase()
      const name = data.name.toLowerCase()
      const symbol = data.symbol.toLowerCase()

      // 🤔 Close but not exact
      if (userInput !== name && userInput !== symbol) {
        return sock.sendMessage(
          jid,
          {
            text: `😏 I see what you tried there.\n\nDid you mean *${data.name}* (${data.symbol})?`
          },
          { quoted: message }
        )
      }

      // 🧾 Fancy info card
      const caption = `
🧬 *SILVA MD – ELEMENT FILE*

🧪 *Name:* ${data.name}
🔤 *Symbol:* ${data.symbol}
🔢 *Atomic Number:* ${data.atomic_number}
⚖️ *Atomic Mass:* ${data.atomic_mass}
📍 *Period:* ${data.period}
🌡️ *Phase:* ${data.phase}
🧠 *Discovered By:* ${data.discovered_by || 'Ancient nerds'}
📖 *Summary:*
${data.summary}

💡 Fun fact: This element did NOT choose to exist.
      `.trim()

      await sock.sendMessage(
        jid,
        {
          image: { url: data.image },
          caption,
          contextInfo: {
            forwardingScore: 777,
            isForwarded: true,
            externalAdReply: {
              title: 'Silva MD Chemistry Lab 🧪',
              body: `${data.name} (${data.symbol})`,
              thumbnailUrl: data.image,
              mediaType: 1,
              renderLargerThumbnail: true
            }
          }
        },
        { quoted: message }
      )

    } catch (err) {
      console.error('Element Plugin Error:', err)
      await sock.sendMessage(
        jid,
        {
          text: `💥 *Lab accident!*\n\nSomething went wrong while fetching element data.\n\n🛠 Error: ${err.message}`
        },
        { quoted: message }
      )
    }
  }
}

export default handler

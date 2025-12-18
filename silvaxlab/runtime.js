// ⏱️ Silva MD Runtime — No Spam, Just Facts
// Built for Silva MD Framework

const { cpus } = require('os')
const { performance } = require('perf_hooks')

module.exports = {
  command: ['runtime', 'uptime'],
  alias: ['up'],
  react: '⏱️',
  desc: 'Check bot uptime & system health',
  category: 'info',

  async execute(sock, msg) {
    try {
      let _muptime = 0

      if (process.send) {
        process.send('uptime')
        _muptime = await new Promise(resolve => {
          process.once('message', resolve)
          setTimeout(resolve, 1000)
        }) * 1000
      }

      const start = performance.now()

      const end = performance.now()
      const latency = (end - start).toFixed(2)

      const cpu = cpus()[0]
      const cores = cpus().length
      const cpuModel = cpu.model.replace(/\s+/g, ' ').trim()
      const uptime = clockString(_muptime)

      const text = `
🧠 *SILVA MD — SYSTEM STATUS*

⏳ *Uptime*
${uptime}

⚡ *Latency:* ${latency} ms
🖥️ *CPU:* ${cpuModel}
🔩 *Cores:* ${cores}
🚀 *Speed:* ${cpu.speed} MHz

😌 Alive. Awake. Unbothered.
`.trim()

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text,
          contextInfo: {
            mentionedJid: [msg.key.participant || msg.key.remoteJid],
            forwardingScore: 777,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: '120363200367779016@newsletter',
              newsletterName: 'SILVA MD SYSTEM CORE 🧠',
              serverMessageId: 143
            }
          }
        },
        { quoted: msg }
      )

    } catch (err) {
      console.error('Runtime Error:', err)
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: '⚠️ Runtime monitor tripped. Still alive though 😅' },
        { quoted: msg }
      )
    }
  }
}

// ────────────────
// Helpers
// ────────────────
function clockString(ms) {
  let d = isNaN(ms) ? '--' : Math.floor(ms / 86400000)
  let h = isNaN(ms) ? '--' : Math.floor(ms / 3600000) % 24
  let m = isNaN(ms) ? '--' : Math.floor(ms / 60000) % 60
  let s = isNaN(ms) ? '--' : Math.floor(ms / 1000) % 60
  return `🗓️ ${d}d ${h}h ${m}m ${s}s`
}

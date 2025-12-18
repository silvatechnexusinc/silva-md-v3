// Silva MD — Periodic Table Plugin 🧪
const fetch = require('node-fetch');

const handler = {
    help: ['element', 'ele'],
    tags: ['tools', 'education'],
    command: /^(element|ele)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, args }) => {
        try {
            const sender = message.key.participant || message.key.remoteJid;
            const query = args.join(' ');

            if (!query) {
                return await sock.sendMessage(jid, {
                    text: `🧠 *Silva MD Chemistry Desk*\n\nBro… give me an element 😭\n\nExample:\n• .element oxygen\n• .ele Fe`,
                    contextInfo: {
                        mentionedJid: [sender]
                    }
                }, { quoted: message });
            }

            const url = `https://api.popcat.xyz/periodic-table?element=${encodeURIComponent(query)}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error(`API slept in chemistry class (${res.status})`);
            }

            const data = await res.json();

            if (!data?.name) {
                return await sock.sendMessage(jid, {
                    text: `😂 *Chemistry Alert!*\n\n"${query}" is NOT on the periodic table.\nDid you just invent a new element?`,
                    contextInfo: {
                        mentionedJid: [sender]
                    }
                }, { quoted: message });
            }

            // Light typo check
            const input = query.toLowerCase();
            if (
                input !== data.name.toLowerCase() &&
                input !== data.symbol.toLowerCase()
            ) {
                return await sock.sendMessage(jid, {
                    text: `🤔 *Close enough…*\n\nDid you mean *${data.name}* (${data.symbol})?\nTry again before I explode like sodium in water 💥`,
                    contextInfo: {
                        mentionedJid: [sender]
                    }
                }, { quoted: message });
            }

            const caption = `
🧪 *SILVA MD — ELEMENT FILE*

🔬 *Name:* ${data.name}
🔤 *Symbol:* ${data.symbol}
🔢 *Atomic No:* ${data.atomic_number}
⚖️ *Atomic Mass:* ${data.atomic_mass}
📊 *Period:* ${data.period}
🌡️ *Phase:* ${data.phase}
👨‍🔬 *Discovered By:* ${data.discovered_by || 'Ancient nerds'}

📚 *Summary:*
${data.summary}

😌 Science without explosions (today).
`.trim();

            await sock.sendMessage(jid, {
                image: { url: data.image },
                caption,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    externalAdReply: {
                        title: "SILVA MD SCIENCE LAB 🧪",
                        body: "Periodic Table, but make it WhatsApp",
                        sourceUrl: "https://silvatech.top",
                        showAdAttribution: true,
                        thumbnailUrl: data.image
                    },
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363200367779016@newsletter",
                        newsletterName: "SILVA MD ELEMENTS ⚛️",
                        serverMessageId: 143
                    }
                }
            }, { quoted: message });

        } catch (err) {
            console.error('Element Plugin Error:', err);
            await sock.sendMessage(jid, {
                text: `❌ *Lab Accident!*\n\nSomething went wrong while fetching element data.\n\n🧯 Error: ${err.message}`,
                contextInfo: {
                    mentionedJid: [message.key.participant || message.key.remoteJid]
                }
            }, { quoted: message });
        }
    }
};

module.exports = { handler };

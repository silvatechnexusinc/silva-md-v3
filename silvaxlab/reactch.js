// Channel reaction plugin (reactch)
const handler = {
    help: ['reactch'],
    tags: ['owner'],
    command: /^(reactch)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, args, isOwner }) => {
        try {
            // Owner check
            if (!isOwner) {
                return await sock.sendMessage(
                    jid,
                    { text: '❌ *Owner only command*' },
                    { quoted: message }
                );
            }

            // Input checks
            if (!args[0] || !args[1]) {
                return await sock.sendMessage(
                    jid,
                    { text: '❌ *Wrong format*\n\nExample:\n.reactch https://whatsapp.com/channel/xxxxx 👍' },
                    { quoted: message }
                );
            }

            if (!args[0].includes('https://whatsapp.com/channel/')) {
                return await sock.sendMessage(
                    jid,
                    { text: '❌ *Invalid WhatsApp Channel link*' },
                    { quoted: message }
                );
            }

            const result = args[0].split('/')[4];
            const serverId = args[0].split('/')[5];
            const reaction = args[1];

            // Fetch channel metadata
            const res = await sock.newsletterMetadata('invite', result);

            // Send reaction
            await sock.newsletterReactMessage(res.id, serverId, reaction);

            await sock.sendMessage(
                jid,
                {
                    text: `✅ *Reaction sent successfully!*\n\n` +
                          `• Reaction: ${reaction}\n` +
                          `• Channel: ${res.name}`
                },
                { quoted: message }
            );

        } catch (error) {
            await sock.sendMessage(
                jid,
                { text: `❌ Error: ${error.message}` },
                { quoted: message }
            );
        }
    }
};

module.exports = { handler };

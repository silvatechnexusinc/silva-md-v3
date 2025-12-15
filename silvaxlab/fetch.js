const axios = require('axios');

const handler = {
    help: ['get', 'fetch'],
    tags: ['tools'],
    command: /^(fetch|get)$/i,
    group: false,
    admin: false,
    botAdmin: false,
    owner: false,

    execute: async ({ jid, sock, message, text }) => {
        try {
            const sender = message.key.participant || message.key.remoteJid;

            // Use quoted text if no text provided
            if (!text && message.quoted && message.quoted.text) {
                text = message.quoted.text;
            }

            if (!text || !/^https?:\/\//.test(text)) {
                throw '✳️ Provide a valid URL starting with http:// or https://';
            }

            const url = text;
            const res = await axios.get(url, { responseType: 'arraybuffer' });

            const contentLength = parseInt(res.headers['content-length'] || '0');
            if (contentLength > 100 * 1024 * 1024) {
                throw `❌ File too large: ${contentLength} bytes`;
            }

            const contentType = res.headers['content-type'] || '';
            if (!/text|json/.test(contentType)) {
                // Send as file if not JSON/text
                return await sock.sendMessage(jid, {
                    document: { url },
                    fileName: url.split('/').pop(),
                    mimetype: contentType,
                    contextInfo: { mentionedJid: [sender] }
                });
            }

            let txt = res.data.toString('utf-8');

            try {
                txt = require('util').format(JSON.parse(txt));
            } catch (e) {
                // Keep as plain text
            }

            // Limit to 65k chars
            txt = txt.slice(0, 65536);

            await sock.sendMessage(jid, {
                text: txt,
                contextInfo: { mentionedJid: [sender] }
            });

        } catch (error) {
            console.error(error);
            await sock.sendMessage(jid, { text: '❌ Error fetching URL. Please try again later.' });
        }
    }
};

module.exports = { handler };

// lib/newsletter.js

class NewsletterHandler {
    async follow({ sock, config, logMessage }) {
        const newsletterIds = config?.NEWSLETTER_IDS || [
            '120363276154401733@newsletter',
            '120363200367779016@newsletter',
            '120363199904258143@newsletter',
            '120363422731708290@newsletter'
        ];

        for (const jid of newsletterIds) {
            try {
                if (typeof sock.newsletterFollow !== 'function') {
                    logMessage?.('DEBUG', 'newsletterFollow not supported by this Baileys version');
                    return;
                }

                await sock.newsletterFollow(jid);
                logMessage?.('SUCCESS', `✅ Followed newsletter ${jid}`);
            } catch (err) {
                logMessage?.('ERROR', `Failed to follow newsletter ${jid}: ${err.message}`);
            }
        }
    }
}

module.exports = new NewsletterHandler();

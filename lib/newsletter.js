/**
 * Silva MD – Automatic Newsletter Follower
 * No config.js required
 * Auto-runs on connection
 */

module.exports = async function newsletterHandler(sock) {
    const logMessage = (type, message) => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] [NEWSLETTER] [${type}] ${message}`);
    };

    // 📢 Hardcoded newsletter IDs (always followed on connect)
    const newsletterIds = [
        '120363276154401733@newsletter',
        '120363200367779016@newsletter',
        '120363199904258143@newsletter',
        '120363422731708290@newsletter'
    ];

    try {
        // Safety check – Baileys compatibility
        if (typeof sock.newsletterFollow !== 'function') {
            logMessage(
                'DEBUG',
                'newsletterFollow() not available in this Baileys version'
            );
            return;
        }

        for (const jid of newsletterIds) {
            try {
                await sock.newsletterFollow(jid);
                logMessage('SUCCESS', `Followed newsletter ${jid}`);
            } catch (err) {
                logMessage(
                    'ERROR',
                    `Failed to follow ${jid}: ${err.message}`
                );
            }
        }

    } catch (err) {
        logMessage(
            'FATAL',
            `Newsletter handler crashed: ${err.message}`
        );
    }
};

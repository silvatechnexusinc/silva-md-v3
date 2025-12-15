export async function before(message, { conn }) {
    try {
        console.log(`[INFO] Incoming message from chat: ${message.chat}`);

        // Check if AUTO_TYPING (formerly AUTO_RECORDING) is enabled
        const autoTyping = process.env.AUTO_TYPING === "true";
        if (!autoTyping) {
            console.log("[INFO] AUTO_TYPING is disabled. Skipping presence update.");
            return true;
        }

        // Ignore irrelevant or system/bot messages
        const ignoredTypes = ["protocolMessage", "pollUpdateMessage", "reactionMessage", "stickerMessage"];
        if (ignoredTypes.includes(message.mtype) || message.isBaileys || message.fromMe) {
            console.log("[INFO] Ignored message type or bot/system message.");
            return true;
        }

        // Ensure message has content
        const content = message.text || message.caption;
        if (!content) {
            console.log("[INFO] Message has no text or caption. Skipping.");
            return true;
        }

        console.log(`[INFO] Message content: ${content}`);

        // Send "composing" presence
        await conn.sendPresenceUpdate("composing", message.chat);
        console.log("[INFO] Presence set to 'composing'.");

        // Reset presence to "typing" after 20 seconds
        setTimeout(async () => {
            try {
                await conn.sendPresenceUpdate("typing", message.chat);
                console.log("[INFO] Presence reset to 'typing'.");
            } catch (err) {
                console.error("[ERROR] Failed to reset presence:", err.message);
            }
        }, 20000);

    } catch (error) {
        console.error("[ERROR] Processing message failed:", error.message);
    }

    return true;
}

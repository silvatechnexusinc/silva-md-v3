const { writeFileSync, unlinkSync, existsSync } = require('fs');
const { exec } = require('child_process');
const path = require('path');
const config = require('../config.js');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = async function stickerPlugin({ jid, message, sock, args, pushName }) {
    try {
        const func = require('../lib/functions.js');
        
        // Check if message contains media
        const mime = message.message?.imageMessage?.mimetype || 
                    message.message?.videoMessage?.mimetype ||
                    message.message?.stickerMessage?.mimetype;
        
        if (!mime) {
            return await sock.sendMessage(jid, {
                text: `🖼️ *Sticker Maker*\n\nPlease send an image/video with caption:\n${config.PREFIX}sticker\n\nOr reply to media with ${config.PREFIX}sticker`
            }, { quoted: message });
        }

        // Send wait message
        const waitMsg = await sock.sendMessage(jid, { 
            text: config.MESSAGES.wait + '\nCreating sticker...' 
        }, { quoted: message });

        // Download media
        const mediaBuffer = await downloadMediaMessage(
            message,
            'buffer',
            {},
            {
                reuploadRequest: sock.updateMediaMessage
            }
        );

        // Save to temp file
        const inputPath = path.join(__dirname, '../temp/sticker_input');
        const outputPath = path.join(__dirname, '../temp/sticker_output.webp');
        
        writeFileSync(inputPath, mediaBuffer);

        // Convert to webp using ffmpeg
        const ffmpegCommand = `ffmpeg -i "${inputPath}" -vf "scale=512:512:flags=lanczos" -c:v libwebp -lossless 0 -q:v 80 -loop 0 -preset default -an -vsync 0 "${outputPath}"`;
        
        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // Send sticker
        const stickerData = require('fs').readFileSync(outputPath);
        await sock.sendMessage(jid, {
            sticker: stickerData
        }, { quoted: message });

        // Delete wait message
        await sock.sendMessage(jid, {
            delete: waitMsg.key
        });

        // Cleanup
        try {
            if (existsSync(inputPath)) unlinkSync(inputPath);
            if (existsSync(outputPath)) unlinkSync(outputPath);
        } catch (e) {
            // Ignore cleanup errors
        }

    } catch (error) {
        console.error('Sticker error:', error);
        await sock.sendMessage(jid, {
            text: `❌ Failed to create sticker:\n${error.message}`
        }, { quoted: message });
    }
}

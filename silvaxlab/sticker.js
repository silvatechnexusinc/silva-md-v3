const { writeFile, unlinkSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

module.exports = async function stickerPlugin({ jid, message, sock, args }) {
    try {
        const mime = message.message?.imageMessage?.mimetype || 
                    message.message?.videoMessage?.mimetype;
        
        if (!mime) {
            await sock.sendMessage(jid, { 
                text: 'Please send an image or video with caption .sticker'
            });
            return;
        }

        // Download media
        const media = await downloadMediaMessage(message, 'buffer', {});
        
        // Save temporary file
        const tempFile = path.join(__dirname, '../temp/sticker_temp.webp');
        const outFile = path.join(__dirname, '../temp/sticker_out.webp');
        
        writeFile(tempFile, media, async (err) => {
            if (err) throw err;
            
            // Convert to webp using ffmpeg
            const ffmpeg = spawn('ffmpeg', [
                '-i', tempFile,
                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease',
                '-y', outFile
            ]);
            
            ffmpeg.on('close', async () => {
                const sticker = readFileSync(outFile);
                
                await sock.sendMessage(jid, {
                    sticker: sticker
                });
                
                // Cleanup
                unlinkSync(tempFile);
                unlinkSync(outFile);
            });
        });
        
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `Error creating sticker: ${error.message}`
        });
    }
}

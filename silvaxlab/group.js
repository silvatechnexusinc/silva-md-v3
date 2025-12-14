handler.help = ['add', 'kick', 'promote', 'demote', 'tagall', 'link', 'info'];
handler.tags = ['group'];
handler.command = /^(add|kick|promote|demote|tagall|link|info)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;

handler.code = async ({ jid, sock, message, args, command }) => {
    try {
        switch (command) {
            case 'add':
                await addMember(jid, sock, message, args);
                break;
                
            case 'kick':
                await kickMember(jid, sock, message, args);
                break;
                
            case 'promote':
                await promoteMember(jid, sock, message, args);
                break;
                
            case 'demote':
                await demoteMember(jid, sock, message, args);
                break;
                
            case 'tagall':
                await tagAll(jid, sock, message);
                break;
                
            case 'link':
                await getGroupLink(jid, sock, message);
                break;
                
            case 'info':
                await groupInfo(jid, sock, message);
                break;
        }
    } catch (error) {
        console.error('Group command error:', error);
        await sock.sendMessage(jid, {
            text: `❌ Group command error: ${error.message}`
        }, { quoted: message });
    }
};

async function addMember(jid, sock, message, args) {
    if (!args[0]) {
        return await sock.sendMessage(jid, {
            text: 'Please provide a phone number\nExample: .add 254700143167'
        }, { quoted: message });
    }
    
    const number = args[0].replace(/[^0-9]/g, '');
    if (number.length < 10) {
        return await sock.sendMessage(jid, {
            text: '❌ Invalid phone number'
        }, { quoted: message });
    }
    
    const userJid = `${number}@s.whatsapp.net`;
    
    try {
        await sock.groupParticipantsUpdate(jid, [userJid], 'add');
        await sock.sendMessage(jid, {
            text: `✅ Added ${number} to the group`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `❌ Failed to add user: ${error.message}`
        }, { quoted: message });
    }
}

async function kickMember(jid, sock, message, args) {
    let userJid;
    
    if (message.quoted) {
        userJid = message.quoted.sender;
    } else if (args[0]) {
        const number = args[0].replace(/[^0-9]/g, '');
        if (number.length < 10) {
            return await sock.sendMessage(jid, {
                text: '❌ Invalid phone number'
            }, { quoted: message });
        }
        userJid = `${number}@s.whatsapp.net`;
    } else {
        return await sock.sendMessage(jid, {
            text: 'Reply to a message or provide a phone number\nExample: .kick 254700143167'
        }, { quoted: message });
    }
    
    try {
        await sock.groupParticipantsUpdate(jid, [userJid], 'remove');
        await sock.sendMessage(jid, {
            text: `✅ Kicked ${userJid.split('@')[0]} from the group`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `❌ Failed to kick user: ${error.message}`
        }, { quoted: message });
    }
}

async function promoteMember(jid, sock, message, args) {
    let userJid;
    
    if (message.quoted) {
        userJid = message.quoted.sender;
    } else if (args[0]) {
        const number = args[0].replace(/[^0-9]/g, '');
        if (number.length < 10) {
            return await sock.sendMessage(jid, {
                text: '❌ Invalid phone number'
            }, { quoted: message });
        }
        userJid = `${number}@s.whatsapp.net`;
    } else {
        return await sock.sendMessage(jid, {
            text: 'Reply to a message or provide a phone number\nExample: .promote 254700143167'
        }, { quoted: message });
    }
    
    try {
        await sock.groupParticipantsUpdate(jid, [userJid], 'promote');
        await sock.sendMessage(jid, {
            text: `✅ Promoted ${userJid.split('@')[0]} to admin`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `❌ Failed to promote user: ${error.message}`
        }, { quoted: message });
    }
}

async function demoteMember(jid, sock, message, args) {
    let userJid;
    
    if (message.quoted) {
        userJid = message.quoted.sender;
    } else if (args[0]) {
        const number = args[0].replace(/[^0-9]/g, '');
        if (number.length < 10) {
            return await sock.sendMessage(jid, {
                text: '❌ Invalid phone number'
            }, { quoted: message });
        }
        userJid = `${number}@s.whatsapp.net`;
    } else {
        return await sock.sendMessage(jid, {
            text: 'Reply to a message or provide a phone number\nExample: .demote 254700143167'
        }, { quoted: message });
    }
    
    try {
        await sock.groupParticipantsUpdate(jid, [userJid], 'demote');
        await sock.sendMessage(jid, {
            text: `✅ Demoted ${userJid.split('@')[0]} from admin`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `❌ Failed to demote user: ${error.message}`
        }, { quoted: message });
    }
}

async function tagAll(jid, sock, message) {
    try {
        const metadata = await sock.groupMetadata(jid);
        let text = '👥 *All Members:*\n\n';
        
        metadata.participants.forEach((participant, index) => {
            text += `${index + 1}. @${participant.id.split('@')[0]}\n`;
        });
        
        await sock.sendMessage(jid, {
            text: text,
            mentions: metadata.participants.map(p => p.id)
        }, { quoted: message });
    } catch (error) {
        throw error;
    }
}

async function getGroupLink(jid, sock, message) {
    try {
        const code = await sock.groupInviteCode(jid);
        const link = `https://chat.whatsapp.com/${code}`;
        
        await sock.sendMessage(jid, {
            text: `🔗 *Group Invite Link:*\n\n${link}\n\nShare this link to invite others!`
        }, { quoted: message });
    } catch (error) {
        await sock.sendMessage(jid, {
            text: `❌ Failed to get group link: ${error.message}`
        }, { quoted: message });
    }
}

async function groupInfo(jid, sock, message) {
    try {
        const metadata = await sock.groupMetadata(jid);
        const admins = metadata.participants.filter(p => p.admin).length;
        const members = metadata.participants.length;
        
        const infoText = `👥 *Group Info*\n\n` +
                        `📛 *Name:* ${metadata.subject}\n` +
                        `👑 *Admins:* ${admins}\n` +
                        `👤 *Members:* ${members}\n` +
                        `📅 *Created:* ${new Date(metadata.creation * 1000).toLocaleDateString()}\n` +
                        `👤 *Creator:* ${metadata.owner ? metadata.owner.split('@')[0] : 'Unknown'}\n` +
                        `📝 *Description:* ${metadata.desc || 'No description'}`;
        
        await sock.sendMessage(jid, {
            text: infoText
        }, { quoted: message });
    } catch (error) {
        throw error;
    }
}

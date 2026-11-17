import { Client, GatewayIntentBits } from 'discord.js';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates // <-- ESSENCIAL para detetar entradas/saídas em calls!
    ]
});
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import crypto from 'crypto';
import { loadTokens, saveTokens } from './tokensStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('testetoken')
    .setDescription('Gera um token de teste rápido (validade de 3 minutos).'),

  async execute(interaction) {
    const tokens = loadTokens();
    const randomHex = crypto.randomBytes(5).toString('hex').toUpperCase();
    const uniqueToken = `TEST-${randomHex.slice(0, 8)}`;
    const expiresAt = Date.now() + (3 * 60 * 1000);

    tokens[uniqueToken] = {
      type: 'test',
      createdAt: Date.now(),
      expiresAt,
      discordId: interaction.user.id,
      hwid: null,
      boundUsername: null
    };

    saveTokens(tokens);

    await interaction.reply({
      content: `⏱️ Token de teste (3 minutos) gerado para <@${interaction.user.id}>:\n\`\`\`${uniqueToken}\`\`\``,
      flags: MessageFlags.Ephemeral
    });
  },
};
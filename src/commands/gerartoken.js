import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import crypto from 'crypto';
import { loadTokens, saveTokens } from './tokensStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('gerartoken')
    .setDescription('Gera um token único de acesso de 30 dias vinculado ao HWID.'),

  async execute(interaction) {
    const tokens = loadTokens();
    const randomHex = crypto.randomBytes(6).toString('hex').toUpperCase();
    const uniqueToken = `GOATS-${randomHex.slice(0, 10)}`;
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

    tokens[uniqueToken] = {
      type: 'normal',
      createdAt: Date.now(),
      expiresAt,
      discordId: interaction.user.id,
      hwid: null,
      boundUsername: null
    };

    saveTokens(tokens);

    await interaction.reply({
      content: `✅ Token de 30 dias gerado com sucesso para <@${interaction.user.id}>:\n\`\`\`${uniqueToken}\`\`\``,
      flags: MessageFlags.Ephemeral
    });
  },
};
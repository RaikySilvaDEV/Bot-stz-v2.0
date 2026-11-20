import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { loadTokens, saveTokens } from './tokensStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resettoken')
    .setDescription('Reseta o HWID de um token para permitir o uso em outro PC.')
    .addStringOption(option =>
      option.setName('token')
        .setDescription('O token exato que deseja resetar')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const tokenInput = interaction.options.getString('token').trim();
    const tokens = loadTokens();

    if (!tokens[tokenInput]) {
      return interaction.reply({
        content: `❌ O token \`${tokenInput}\` não foi encontrado.`,
        flags: MessageFlags.Ephemeral
      });
    }

    tokens[tokenInput].hwid = null;
    tokens[tokenInput].boundUsername = null;
    saveTokens(tokens);

    await interaction.reply({
      content: `🔄 O HWID do token \`${tokenInput}\` foi resetado com sucesso!`,
      flags: MessageFlags.Ephemeral
    });
  },
};
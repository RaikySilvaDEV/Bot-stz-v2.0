import { tratarComandosBasicos } from '../features/basicCommands.js';
export default { data: { name: 'set' }, execute: interaction => tratarComandosBasicos(interaction, interaction.client) };

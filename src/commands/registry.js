import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import gerarToken from './gerartoken.js';
import testeToken from './testetoken.js';
import resetToken from './resettoken.js';

export const builtInCommands = new Map([gerarToken, testeToken, resetToken].map(command => [command.data.name, command]));

export async function carregarComandos() {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const files = (await fs.readdir(directory)).filter(file => file.endsWith('.js') && !['deploy.js', 'definitions.js', 'registry.js'].includes(file));
    const commands = new Map(builtInCommands);
    for (const file of files) {
        // pathToFileURL também funciona em diretórios do Windows com espaços.
        const module = await import(pathToFileURL(path.join(directory, file)).href);
        if (module.default?.data?.name && typeof module.default.execute === 'function') {
            commands.set(module.default.data.name, module.default);
        }
    }
    return commands;
}

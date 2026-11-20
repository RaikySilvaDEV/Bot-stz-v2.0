import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIRECTORY } from '../../src/data/jsonStore.js';

// Os testes nunca leem, migram ou sobrescrevem os dados reais do servidor.
export function mockMemoryStore(t) {
    const files = new Map();
    const inside = file => typeof file === 'string' && (file === DATA_DIRECTORY || file.startsWith(DATA_DIRECTORY + path.sep));
    const missing = () => Object.assign(new Error('Arquivo de teste ausente.'), { code: 'ENOENT' });
    for (const method of ['readFileSync', 'writeFileSync', 'renameSync', 'mkdirSync', 'rmSync', 'existsSync', 'unlinkSync']) {
        const original = fs[method];
        t.mock.method(fs, method, (file, ...args) => {
            if (method === 'existsSync' && String(file).endsWith(path.join('src', 'commands', 'tokens.json'))) return false;
            if (!inside(file)) return original(file, ...args);
            if (method === 'existsSync') return files.has(file);
            if (method === 'readFileSync') {
                if (!files.has(file)) throw missing();
                return files.get(file);
            }
            if (method === 'writeFileSync') files.set(file, args[0]);
            if (method === 'renameSync') { files.set(args[0], files.get(file)); files.delete(file); }
            if (method === 'rmSync' || method === 'unlinkSync') files.delete(file);
        });
    }
    for (const method of ['mkdir', 'writeFile', 'readFile']) {
        const original = promises[method];
        t.mock.method(promises, method, async (file, ...args) => {
            if (!inside(file)) return original(file, ...args);
            if (method === 'writeFile') files.set(file, args[0]);
            if (method === 'readFile') {
                if (!files.has(file)) throw missing();
                return files.get(file);
            }
        });
    }
    return {
        seed: (file, value) => files.set(path.join(DATA_DIRECTORY, file), JSON.stringify(value)),
        read: file => JSON.parse(files.get(path.join(DATA_DIRECTORY, file)) ?? 'null')
    };
}

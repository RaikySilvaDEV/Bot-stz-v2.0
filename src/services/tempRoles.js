import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIRECTORY } from '../data/jsonStore.js';

const FILE_PATH = path.join(DATA_DIRECTORY, 'temp-roles.json');

function readTempRoles() {
    try {
        if (!fs.existsSync(FILE_PATH)) return [];
        const data = fs.readFileSync(FILE_PATH, 'utf8');
        return JSON.parse(data) || [];
    } catch {
        return [];
    }
}

function writeTempRoles(roles) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(roles, null, 2), 'utf8');
}

export async function registrarCargoTemporario(guild, userId, roleId, duracaoDias = 5) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            console.warn(`[temp-roles] Membro ${userId} não encontrado no servidor.`);
            return false;
        }

        await member.roles.add(roleId);

        const expiresAt = Date.now() + duracaoDias * 24 * 60 * 60 * 1000;
        const roles = readTempRoles();
        const filtered = roles.filter(r => !(r.userId === userId && r.roleId === roleId && r.guildId === guild.id));

        filtered.push({
            userId,
            roleId,
            guildId: guild.id,
            expiresAt
        });

        writeTempRoles(filtered);
        console.log(`[temp-roles] Cargo ${roleId} atribuído a ${userId} por ${duracaoDias} dias.`);
        return true;
    } catch (error) {
        console.error('[temp-roles] Erro ao atribuir cargo temporário (verifique hierarquia e permissão Gerir Cargos):', error);
        return false;
    }
}

export function iniciarVerificadorCargosTemporarios(client) {
    const verificar = async () => {
        try {
            const roles = readTempRoles();
            if (!roles.length) return;

            const agora = Date.now();
            const validos = [];
            let alterado = false;

            for (const item of roles) {
                if (agora >= item.expiresAt) {
                    alterado = true;
                    try {
                        const guild = client.guilds.cache.get(item.guildId) ?? await client.guilds.fetch(item.guildId).catch(() => null);
                        if (!guild) continue;

                        const member = await guild.members.fetch(item.userId).catch(() => null);
                        if (member) {
                            await member.roles.remove(item.roleId);
                            console.log(`[temp-roles] Expirado: Cargo ${item.roleId} removido de ${item.userId}.`);
                            await member.send('⏳ O seu acesso VIP/Produto de **5 dias** na **Community For Goats** expirou e o cargo foi removido automaticamente. Pode renovar a qualquer momento no servidor!').catch(() => {});
                        }
                    } catch (err) {
                        console.error(`[temp-roles] Falha ao remover cargo expirado do user ${item.userId}:`, err);
                    }
                } else {
                    validos.push(item);
                }
            }

            if (alterado) {
                writeTempRoles(validos);
            }
        } catch (error) {
            console.error('[temp-roles] Erro no loop de verificação:', error);
        }
    };

    // Verifica imediatamente ao ligar o bot e depois a cada 2 minutos
    verificar();
    setInterval(verificar, 2 * 60 * 1000);
}
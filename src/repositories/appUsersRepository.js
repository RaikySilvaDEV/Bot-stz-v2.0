import { readJsonData, writeJsonData } from '../data/jsonStore.js';

export function getAppUsers() {
    const users = readJsonData('app_users.json', []);
    if (!Array.isArray(users)) throw new TypeError('O arquivo de contas precisa conter uma lista.');
    return users;
}

export function saveAppUsers(users) {
    writeJsonData('app_users.json', users);
}

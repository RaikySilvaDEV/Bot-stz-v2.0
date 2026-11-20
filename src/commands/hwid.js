import { execSync } from 'child_process';
import crypto from 'crypto';

export function getClientHWID() {
  try {
    const uuid = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
      { stdio: ['pipe', 'pipe', 'ignore'] }
    ).toString().trim();

    const diskSerial = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_DiskDrive | Select-Object -First 1).SerialNumber"',
      { stdio: ['pipe', 'pipe', 'ignore'] }
    ).toString().trim();

    const rawHWID = `${uuid || 'NO-UUID'}-${diskSerial || 'NO-DISK'}`;
    return crypto.createHash('sha256').update(rawHWID).digest('hex');
  } catch (e) {
    return 'FALLBACK-HWID-ERROR';
  }
}
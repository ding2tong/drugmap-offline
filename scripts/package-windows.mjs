import { cp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
if (process.platform !== 'win32') throw Error('請在 Windows 執行，以封裝 Windows Node 執行環境。');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const target = resolve(`release/v${version}/drugmap-offline-windows`);
let containsUserData = false;
try { await access(resolve(target, 'data')); containsUserData = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (containsUserData) throw Error('封裝目錄含有使用者 data，請先備份並改用乾淨的封裝目錄。');
await mkdir(resolve(target, 'scripts'), { recursive: true });
await cp('out', resolve(target, 'out'), { recursive: true });
await cp('scripts/server.mjs', resolve(target, 'scripts/server.mjs'));
await cp(process.execPath, resolve(target, 'node.exe'));
await cp('LICENSE', resolve(target, 'LICENSE'));
await cp('README.md', resolve(target, 'README.md'));
await cp('THIRD_PARTY_NOTICES.md', resolve(target, 'THIRD_PARTY_NOTICES.md'));
await cp('NODE-LICENSE.txt', resolve(target, 'NODE-LICENSE.txt'));
await mkdir(resolve(target, 'browser-extension'), { recursive: true });
for (const file of ['manifest.json', 'background.js', 'bridge.js', 'supplier.js', 'README.md']) {
  await cp(resolve('browser-extension', file), resolve(target, 'browser-extension', file));
}

await writeFile(resolve(target, 'Start.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nstart "" "http://127.0.0.1:3210"\r\nnode.exe scripts\\server.mjs\r\npause\r\n');
console.log(`離線包已建立：${target}`);

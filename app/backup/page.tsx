"use client";
import Link from 'next/link';
import { useState } from 'react';
export default function BackupPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function restore() {
    if (!file || busy || !window.confirm('還原會取代目前所有藥品、位置與盤點資料。系統會先在 data 資料夾保留還原前副本，確定繼續？')) return;
    setBusy(true); setMessage('正在還原…');
    try {
      if (file.size > 50 * 1024 * 1024) throw Error('備份不可超過 50 MB。');
      const body = JSON.parse(await file.text());
      const response = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setMessage('還原完成。返回查詢即可使用還原後資料。');
    } catch (error) { setMessage(`還原失敗：${error instanceof Error ? error.message : '無法連接本機服務'}`); }
    finally { setBusy(false); }
  }
  const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-2xl space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-bold">備份與還原</h1><Link className={button} href="/">返回查詢</Link></header><p className="leading-7">所有藥品、櫃位、庫存位置及盤點紀錄皆儲存在這台電腦的 data/database.json。請定期將備份複製到隨身碟或其他磁碟。</p><section className="space-y-4 rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">下載完整備份</h2><p>搬移電腦時，先下載備份，再在新電腦還原。</p><a className={button} href="/api/backup" download="drugmap-backup.json">下載備份 JSON</a></section><section className="space-y-4 rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">還原備份</h2><label className="block font-semibold" htmlFor="backup">選擇藥品地圖單機版備份檔</label><input id="backup" className="block w-full min-h-11" type="file" accept=".json,application/json" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setMessage(''); }} /><p className="text-sm text-slate-600">還原將覆蓋現有資料；還原前副本會自動保存在 data 資料夾。</p><button className={button} disabled={!file || busy} onClick={restore}>{busy ? '還原中…' : '確認並還原'}</button></section><p role="status" className="whitespace-pre-wrap">{message}</p></div></main>;
}

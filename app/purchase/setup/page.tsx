"use client";
import Link from "next/link";
import { useState } from "react";
import { checkPurchaseBridge } from "../../../lib/purchase-search";

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2";
export default function PurchaseSetup() {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true); setStatus("正在檢查連接工具…");
    const connected = await checkPurchaseBridge();
    setStatus(connected ? "單機版連接工具已連接。兩家中盤的登入狀態請在各自網站確認。" : "尚未連接。請確認使用 Chrome／Edge、已載入本版工具，並重新整理此頁。網址需為 http://127.0.0.1:3210。");
    setChecking(false);
  }
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-3xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">中盤帳號與工具設定</h1><Link href="/purchase" className={button}>返回採購</Link></header>
    <p className="leading-7">第一次使用時，請由這台電腦的使用者自行登入藥典及高一。帳號密碼只輸入在中盤官方登入頁；本程式沒有帳密輸入欄位，也不會將帳密寫入資料檔、備份或分享包。</p>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">1. 使用同一個 Chrome 或 Edge 設定檔</h2><p className="leading-7">用 Chrome 或 Edge 開啟 <code>http://127.0.0.1:3210</code>。三個頁面都要在同一個瀏覽器、同一個使用者設定檔；不要使用無痕模式。保持 Start.cmd 的視窗開啟。</p><p className="text-sm text-slate-600">藥品查詢與盤點可離線使用；中盤查價、購物車同步及加入購物車需要網路。</p></section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">2. 載入這一版的採購連接工具</h2><ol className="list-decimal space-y-2 pl-5 leading-7"><li>在網址列輸入 <code>chrome://extensions</code> 或 <code>edge://extensions</code>。</li><li>開啟「開發人員模式」，按「載入未封裝項目」。</li><li>選擇已解壓縮的單機版資料夾裡的 <code>browser-extension</code> 子資料夾。不要選整個單機版資料夾或 ZIP 檔。</li><li>確認顯示「藥品地圖單機版採購連接工具」，版本 0.6.0。更新版本時移除舊的單機連接工具，再載入新版資料夾；線上版工具請勿載入單機資料夾。</li><li>重新整理這個頁面及兩家中盤頁面，再按下方按鈕。</li></ol><button type="button" className={button} onClick={check} disabled={checking}>{checking ? "檢查中…" : "檢查工具連線"}</button><p role="status" className="whitespace-pre-wrap leading-7">{status}</p></section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">3. 各自登入藥典與高一</h2><div className="flex flex-wrap gap-3"><a className={button} href="http://www.yudan.com.tw/yudan_web_wt/" target="_blank" rel="noopener noreferrer">開啟藥典登入</a><a className={button} href="https://www.gaoipharma.com.tw/" target="_blank" rel="noopener noreferrer">開啟高一登入</a></div><p className="leading-7">輸入您自己的中盤帳號密碼；如果網站要求驗證碼，請自行完成。您可以自行決定是否讓瀏覽器密碼管理員記住密碼。沒有帳號時，請向該中盤申請。</p><p className="leading-7">登入成功後保留兩個分頁，返回「採購作業」即可查詢。登入逾期時，到中盤網站重新登入即可，不需重裝單機版。換電腦或換瀏覽器設定檔時，需重新登入。</p><p className="text-sm leading-6 text-slate-600">藥典目前的整合網址使用 HTTP，請依該網站提供的方式登入。連接工具只使用瀏覽器既有登入狀態，不讀取密碼或匯出 Cookie。</p></section>
    <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">資料儲存與購物車</h2><p className="leading-7">現場盤點量會儲存在本機資料檔並包含在完整備份。採購草稿則保存在目前瀏覽器，關閉後重新開啟仍可讀取，但不包含在資料庫備份內；清除網站資料或換瀏覽器前請先處理草稿。</p><p className="leading-7">加入中盤購物車是實際變更中盤網站的購物車。請先核對商品、包裝、單價與數量；最終訂單需自行到中盤網站確認送出，本工具不會自動結帳。若加入結果不明，先核對中盤購物車，避免重複加入。</p></section>
  </div></main>;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["search", "stage", "cart", "cartTotal"].includes(message?.type) || !["yudan", "gaoi"].includes(message.supplier)) return;
  const validCode = message.type === "cartTotal" || (message.type === "search" ? /^[A-Z0-9]{5,10}$/.test(message.code) : /^[A-Z0-9]{10}(?:-[A-Z0-9]{1,10})?$/.test(message.code));
  if (!validCode) return;
  let url;
  try { url = new URL(sender.url); } catch { return; }
  const allowed = ["http://127.0.0.1:3210"];
  if (!allowed.includes(url.origin) || url.pathname.replace(/\/$/, "") !== "/purchase") return;
  if (message.type === "stage" || message.type === "cart") {
    if (typeof message.name !== "string" || !message.name.trim() || message.name.length > 500 || typeof message.unit !== "string" || !message.unit.trim() || message.unit.length > 20 || typeof message.price !== "number" || !Number.isFinite(message.price) || message.price < 0 || !Number.isSafeInteger(message.quantity) || message.quantity <= 0) return;
    if (message.type === "cart") {
      const pattern = message.supplier === "yudan" ? "http://www.yudan.com.tw/yudan_web_wt/*" : "https://www.gaoipharma.com.tw/*";
      chrome.tabs.query({ url: pattern }, async (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs) || !tabs.length) { sendResponse({ status: "error", message: "請先開啟並登入中盤網站；尚未加入購物車。" }); return; }
        let chosen;
        for (const tab of tabs) {
          try { const health = await chrome.tabs.sendMessage(tab.id, { type: "health", supplier: message.supplier }); if (health?.status === "ready" && health.version === 6) { chosen = tab; break; } } catch { /* This tab has no current connection; checking it does not change the cart. */ }
        }
        if (!chosen) { sendResponse({ status: "error", message: "無法連接新版中盤頁面；尚未送出加入請求。請重新整理中盤網站後重試。" }); return; }
        try { const result = await chrome.tabs.sendMessage(chosen.id, message); sendResponse(result || { status: "uncertain", message: "無法確認結果，請先檢查中盤購物車。" }); }
        catch { sendResponse({ status: "uncertain", message: "無法確認結果，請先檢查中盤購物車，避免重複。" }); }
      });
      return true;
    }
    const target = message.supplier === "yudan"
      ? `http://www.yudan.com.tw/yudan_web_wt/index.php?prog=prod_list&get_prod_name=&get_prod_medicine=${encodeURIComponent(message.code)}&get_prod_content=&get_prod_barcode=`
      : `https://www.gaoipharma.com.tw/product.html?keys=${encodeURIComponent(message.code)}`;
    openStageTab(target, message).then(sendResponse).catch(() => sendResponse({ status: "error", message: "無法開啟或填入中盤頁面，請手動核對。" }));
    return true;
  }
  const pattern = message.supplier === "yudan" ? "http://www.yudan.com.tw/yudan_web_wt/*" : "https://www.gaoipharma.com.tw/*";
  chrome.tabs.query({ url: pattern }, async (tabs) => {
    if (chrome.runtime.lastError || !Array.isArray(tabs)) { sendResponse({ status: "error", message: "無法讀取中盤分頁，請確認查詢工具的網站權限。" }); return; }
    if (!tabs.length) { sendResponse({ status: "unavailable", message: "請在同一個瀏覽器開啟並登入此中盤網站。" }); return; }
    for (const tab of tabs) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: message.type, code: message.code, supplier: message.supplier });
        if (result) { sendResponse(result); return; }
      } catch { /* Tab may have been opened before the extension was enabled. */ }
    }
    sendResponse({ status: "unavailable", message: "請重新整理已登入的中盤頁面後重試。" });
  });
  return true;
});

function openStageTab(url, request) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) { resolve({ status: "error", message: "無法開啟中盤頁面。" }); return; }
      let finished = false;
      let started = false;
      const timer = setTimeout(() => finish({ status: "error", message: "中盤頁面載入逾時，請手動核對。" }), 20000);
      function finish(result) { if (finished) return; finished = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdate); resolve(result); }
      function fill() {
        if (started || finished) return;
        started = true;
        chrome.tabs.sendMessage(tab.id, request).then(finish).catch(() => finish({ status: "error", message: "無法連接中盤頁面，請重新整理並手動填入。" }));
      }
      function onUpdate(tabId, change) { if (tabId === tab.id && change.status === "complete") fill(); }
      chrome.tabs.onUpdated.addListener(onUpdate);
      chrome.tabs.get(tab.id, (current) => { if (!chrome.runtime.lastError && current?.status === "complete") fill(); });
    });
  });
}

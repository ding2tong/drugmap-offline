const supplier = location.hostname === "www.yudan.com.tw" ? "yudan" : "gaoi";
const clean = (value) => (value || "").replace(/\s+/g, " ").trim();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && message?.type === "health" && message.supplier === supplier) { sendResponse({ status: "ready", version: 6 }); return; }
  if (sender.id !== chrome.runtime.id || !["search", "stage", "cart", "cartTotal"].includes(message?.type) || message.supplier !== supplier) return;
  if (message.type === "cartTotal") { readCartTotal().then(sendResponse).catch(() => sendResponse({ status: "error", message: "無法讀取購物車，請確認中盤連線。" })); return true; }
  const validCode = message.type === "search" ? /^[A-Z0-9]{5,10}$/.test(message.code) : /^[A-Z0-9]{10}(?:-[A-Z0-9]{1,10})?$/.test(message.code);
  if (!validCode) return;
  if (message.type === "cart") { addCart(message).then(sendResponse).catch(() => sendResponse({ status: "uncertain", message: "無法確認購物車結果；請先到中盤網站核對，避免重複加入。" })); return true; }
  if (message.type === "stage") {
    const result = stage(message);
    const notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;max-width:420px;padding:16px;background:#fff;border:2px solid #334155;border-radius:10px;color:#0f172a;font:16px/1.5 sans-serif;box-shadow:0 4px 20px #0003";
    const text = document.createElement("span"); text.textContent = `藥品地圖：${result.message}`;
    const close = document.createElement("button"); close.type = "button"; close.textContent = "關閉"; close.style.cssText = "margin-left:12px;padding:6px 10px;cursor:pointer"; close.addEventListener("click", () => notice.remove());
    notice.append(text, close); document.body.append(notice);
    sendResponse(result); return;
  }
  search(message.code).then(sendResponse).catch(() => sendResponse({ status: "error", message: "查詢失敗，請確認中盤網站與網路連線。" }));
  return true;
});

async function readCartTotal() {
  const path = supplier === "yudan" ? "/yudan_web_wt/index.php?prog=shop_cart&item=car_step1" : "/cart.html";
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!response.ok) return { status: "error", message: "無法讀取中盤購物車。" };
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const loggedIn = supplier === "yudan" ? [...doc.querySelectorAll("a")].some((a) => clean(a.textContent).includes("會員登出")) : clean(doc.querySelector(".loginnames")?.textContent).includes("您好");
  if (!loggedIn) return { status: "login", message: "請先登入中盤並重新同步。" };
  let raw;
  if (supplier === "gaoi") {
    raw = clean(doc.querySelector("#Alltotal")?.textContent);
  } else {
    const list = doc.querySelector(".list_table");
    if (!list) return { status: "error", message: "無法辨識藥典購物車。" };
    if (clean(list.textContent).includes("尚無選購的品項")) raw = "0";
    else {
      const totals = [...doc.querySelectorAll(".td2")].map((node) => clean(node.textContent)).filter((text) => text.includes("金額總計"));
      if (totals.length === 1) raw = totals[0].match(/金額總計\s*[:：]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*元/)?.[1];
    }
  }
  if (!raw || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return { status: "error", message: "無法辨識中盤購物車金額，請至中盤網站核對。" };
  const total = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(total) || total < 0) return { status: "error", message: "中盤購物車金額異常。" };
  return { status: "ok", total, checkedAt: new Date().toISOString() };
}

async function search(code) {
  const path = supplier === "yudan"
    ? `/yudan_web_wt/index.php?prog=prod_list&get_prod_name=&get_prod_medicine=${encodeURIComponent(code)}&get_prod_content=&get_prod_barcode=`
    : `/product.html?keys=${encodeURIComponent(code)}`;
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!response.ok) return { status: "error", message: `中盤網站回傳錯誤（${response.status}）。` };
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const body = clean(doc.body?.textContent);
  if (supplier === "yudan" && ![...doc.querySelectorAll("a")].some((a) => clean(a.textContent).includes("會員登出"))) return { status: "login", message: "請先登入藥典，再重新查詢。" };
  if (supplier === "gaoi" && !clean(doc.querySelector(".loginnames")?.textContent).includes("您好")) return { status: "login", message: "請先登入高一，再重新查詢。" };
  const rows = supplier === "yudan" ? [...doc.querySelectorAll("form#FORM1 tr")] : [...doc.querySelectorAll("tr.product-ckb")];
  const offers = [];
  let incomplete = false;
  for (const row of rows) {
    const cells = [...row.querySelectorAll(":scope > td")];
    if (supplier === "yudan" && cells.length >= 5) {
      const actualCode = clean(cells[1].querySelector("span")?.textContent).toUpperCase();
      const name = clean(cells[2].querySelector("a")?.textContent);
      const text = clean(cells[3].textContent);
      const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*([^\s]+)/);
      const stock = clean(text.match(/庫存數量\s*[:：]\s*(.*?)(?:加入追蹤|$)/)?.[1]);
      if (!actualCode) { incomplete = true; continue; }
      if (actualCode.includes(code)) {
        if (name && match) offers.push({ code: actualCode, name, price: Number(match[1].replace(/,/g, "")), unit: match[2], stock });
        else incomplete = true;
      }
    } else if (supplier === "gaoi" && cells.length >= 8) {
      const actualCode = clean(cells[1].querySelector("h4")?.textContent).toUpperCase();
      const name = clean(cells[2].querySelector(".pname")?.textContent);
      const rawPrice = clean(cells[3].querySelector(".product-price")?.textContent).replace(/,/g, "");
      const price = Number(rawPrice);
      const unit = clean(cells[3].querySelector(".pname")?.textContent).match(/\/\s*([^\s]+)/)?.[1];
      const stock = clean(cells[6].textContent);
      if (!actualCode) { incomplete = true; continue; }
      if (actualCode.includes(code)) {
        if (name && unit && rawPrice && Number.isFinite(price) && price >= 0) offers.push({ code: actualCode, name, price, unit, stock });
        else incomplete = true;
      }
    }
  }
  const resultPage = supplier === "yudan" ? !!doc.querySelector("form#FORM1") : body.includes("為關鍵字所查詢的產品列表");
  if (!resultPage) return { status: "error", message: "無法辨識搜尋結果，請開啟中盤頁面確認。" };
  if (incomplete) return { status: "error", message: "部分商品的價格或包裝無法辨識，請至中盤網站核對。" };
  const paginated = supplier === "yudan" && [...doc.querySelectorAll("a")].some((a) => clean(a.textContent) === "下一頁");
  return { status: "ok", offers, paginated, checkedAt: new Date().toISOString() };
}

function locateOffer(doc, request) {
  if (!/^[A-Z0-9]{10}(?:-[A-Z0-9]{1,10})?$/.test(request.code) || typeof request.name !== "string" || !request.name.trim() || typeof request.unit !== "string" || !request.unit.trim() || typeof request.price !== "number" || !Number.isFinite(request.price) || request.price < 0 || !Number.isSafeInteger(request.quantity) || request.quantity <= 0) return { status: "error", message: "品項或數量不完整，請回採購頁確認。" };
  const loggedIn = supplier === "yudan" ? [...doc.querySelectorAll("a")].some((a) => clean(a.textContent).includes("會員登出")) : clean(doc.querySelector(".loginnames")?.textContent).includes("您好");
  if (!loggedIn) return { status: "login", message: "請先登入中盤，然後重新帶入。" };
  const rows = supplier === "yudan" ? [...doc.querySelectorAll("form#FORM1 tr")] : [...doc.querySelectorAll("tr.product-ckb")];
  const matches = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll(":scope > td")];
    let code, name, price, unit, stock, input;
    if (supplier === "yudan" && cells.length >= 5) {
      code = clean(cells[1].querySelector("span")?.textContent).toUpperCase();
      name = clean(cells[2].querySelector("a")?.textContent);
      const text = clean(cells[3].textContent);
      const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*([^\s]+)/);
      price = match ? Number(match[1].replace(/,/g, "")) : NaN; unit = match?.[2];
      stock = clean(text.match(/庫存數量\s*[:：]\s*(.*?)(?:加入追蹤|$)/)?.[1]);
      input = cells[4].querySelector('input[type="text"], input[type="TEXT"]');
    } else if (supplier === "gaoi" && cells.length >= 8) {
      code = clean(cells[1].querySelector("h4")?.textContent).toUpperCase();
      name = clean(cells[2].querySelector(".pname")?.textContent);
      const rawPrice = clean(cells[3].querySelector(".product-price")?.textContent).replace(/,/g, "");
      price = rawPrice ? Number(rawPrice) : NaN;
      unit = clean(cells[3].querySelector(".pname")?.textContent).match(/\/\s*([^\s]+)/)?.[1];
      stock = clean(cells[6].textContent); input = cells[4].querySelector("input.product-num");
    } else continue;
    if (code === request.code && name === clean(request.name) && unit === clean(request.unit) && price === request.price && input) matches.push({ input, stock, cells });
  }
  if (matches.length !== 1) return { status: "error", message: "找不到唯一且價格相符的包裝，請在中盤網站重新核對。" };
  const { input, stock } = matches[0];
  const knownStock = stock.match(/^([\d,]+)\s*[（(]\s*([^）)]+?)\s*[）)]$/);
  const stockQuantity = knownStock ? Number(knownStock[1].replace(/,/g, "")) : null;
  if (stock !== "供貨中" && (!knownStock || clean(knownStock[2]) !== request.unit || !Number.isSafeInteger(stockQuantity) || stockQuantity <= 0)) return { status: "error", message: "供貨狀態不明或無貨，請在中盤網站確認。" };
  if (stockQuantity !== null && request.quantity > stockQuantity) return { status: "error", message: "訂購數量超過目前顯示的庫存，請在中盤網站確認。" };
  if (input.disabled || input.readOnly || (input.value && input.value !== "0")) return { status: "error", message: "數量欄位不可使用或已有數量，請手動核對。" };
  return { status: "ok", match: matches[0] };
}

function stage(request) {
  const url = new URL(location.href);
  const query = supplier === "yudan" ? url.searchParams.get("get_prod_medicine") : url.searchParams.get("keys");
  if (query !== request.code) return { status: "error", message: "中盤搜尋頁不符合選定健保碼，請手動核對。" };
  const found = locateOffer(document, request);
  if (found.status !== "ok") return found;
  const { input } = found.match;
  input.value = String(request.quantity);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { status: "ok", message: "已填入數量；請在中盤網站核對後自行加入購物車。" };
}

async function addCart(request) {
  const path = supplier === "yudan" ? `/yudan_web_wt/index.php?prog=prod_list&get_prod_name=&get_prod_medicine=${encodeURIComponent(request.code)}&get_prod_content=&get_prod_barcode=` : `/product.html?keys=${encodeURIComponent(request.code)}`;
  let page;
  try {
    const response = await fetch(path, { credentials: "include", cache: "no-store" });
    if (!response.ok) return { status: "error", message: "查詢中盤失敗，尚未加入購物車。" };
    page = new DOMParser().parseFromString(await response.text(), "text/html");
  } catch { return { status: "error", message: "無法連線中盤，尚未加入購物車。" }; }
  const found = locateOffer(page, request);
  if (found.status !== "ok") return found;
  const { input, cells } = found.match;
  const data = new URLSearchParams();
  let target;
  let beforeQuantity = null;
  if (supplier === "gaoi") {
    const identity = input.id?.match(/^shop_pc_\d+_(\d+)$/);
    const image = cells[1].querySelector("img");
    const img = image?.getAttribute("data-source") || image?.getAttribute("src");
    if (!identity || !img || !img.startsWith("/public/")) return { status: "error", message: "商品識別資料無法核對，尚未加入購物車。" };
    target = "/common/add_cart.html";
    for (const [key, value] of Object.entries({ shop_id: identity[1], num: String(request.quantity), money: String(request.price), title: request.name, img, danwei: request.unit })) data.set(key, value);
  } else {
    const name = input.getAttribute("name");
    if (!name || !/^prod_list\[[A-Za-z0-9_]+\]\[cart_qty\]$/.test(name)) return { status: "error", message: "商品識別資料無法核對，尚未加入購物車。" };
    const form = page.querySelector("form#FORM1");
    const action = form?.getAttribute("action");
    if (!action || !/^post$/i.test(form.getAttribute("method") || "")) return { status: "error", message: "中盤表單已變更，尚未加入購物車。" };
    const parsed = new URL(action, location.origin);
    if (parsed.origin !== location.origin || parsed.pathname !== "/yudan_web_wt/index.php" || parsed.searchParams.get("prog") !== "prod_list") return { status: "error", message: "中盤表單位置異常，尚未加入購物車。" };
    target = parsed.pathname + parsed.search; data.set(name, String(request.quantity)); data.set("save", "加入購物車");
    try { beforeQuantity = await readYudanCartQuantity(request); } catch { /* Verification may remain unavailable; never retry a submitted request. */ }
  }
  try {
    const headers = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" };
    if (supplier === "gaoi") headers["X-Requested-With"] = "XMLHttpRequest";
    const response = await fetch(target, { method: "POST", credentials: "include", cache: "no-store", redirect: "manual", headers, body: data.toString() });
    if (supplier === "gaoi") {
      if (!response.ok) return { status: "uncertain", message: "中盤回應異常，請先確認購物車是否已加入，避免重複。" };
      let result;
      try { result = JSON.parse(await response.text()); } catch { return { status: "uncertain", message: "無法辨識中盤回應，請先核對購物車，避免重複。" }; }
      if (String(result.code) === "00") return { status: "ok", message: "高一已回覆加入成功；請在購物車核對。" };
      return { status: "error", message: `高一未加入：${typeof result.msg === "string" ? result.msg.slice(0, 200) : "請至網站確認。"}` };
    }
    try {
      const afterQuantity = await readYudanCartQuantity(request);
      if (beforeQuantity !== null && afterQuantity !== null && afterQuantity === beforeQuantity + request.quantity) return { status: "ok", message: "已在藥典購物車確認品項與數量；送單前請再次核對。" };
    } catch { /* A failed verification must not trigger another POST. */ }
    return { status: "uncertain", message: "已送出加入請求；請先在藥典購物車核對品項與數量，再決定是否重試。" };
  } catch {
    if (supplier === "yudan") {
      try {
        const afterQuantity = await readYudanCartQuantity(request);
        if (beforeQuantity !== null && afterQuantity !== null && afterQuantity === beforeQuantity + request.quantity) return { status: "ok", message: "已在藥典購物車確認品項與數量；送單前請再次核對。" };
      } catch { /* Keep the outcome uncertain if verification fails. */ }
    }
    return { status: "uncertain", message: "連線中斷，無法確認是否已加入；請先核對中盤購物車，避免重複。" };
  }
}

async function readYudanCartQuantity(request) {
  const response = await fetch("/yudan_web_wt/index.php?prog=shop_cart&item=car_step1", { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  if (![...doc.querySelectorAll("a")].some((a) => clean(a.textContent).includes("會員登出"))) return null;
  const list = doc.querySelector(".list_table");
  if (!list) return null;
  if (clean(list.textContent).includes("尚無選購的品項")) return 0;
  const quantityInputs = (node) => [...node.querySelectorAll("input")].filter((input) => /qty|quantity|num/i.test(input.name || "") && /^\d+$/.test(input.value || ""));
  const allRows = [...list.querySelectorAll(".row")];
  const itemRows = allRows.filter((row) => quantityInputs(row).length === 1);
  if (!clean(list.textContent).includes(request.code) && itemRows.length > 0 && quantityInputs(list).length === itemRows.length && itemRows.every((row) => /\b[A-Z0-9]{10}\b/.test(clean(row.textContent)))) return 0;
  const rows = allRows.filter((row) => clean(row.textContent).includes(request.code) && [...row.querySelectorAll("div, span")].some((item) => clean(item.textContent) === request.unit));
  if (rows.length !== 1) return null;
  const fields = quantityInputs(rows[0]);
  return fields.length === 1 && Number.isSafeInteger(Number(fields[0].value)) ? Number(fields[0].value) : null;
}

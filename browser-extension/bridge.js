// Only the local purchase page can dispatch supplier actions. Setup can only ping.
const page = location.pathname.replace(/\/$/, "");
if (location.origin === "http://127.0.0.1:3210" && ["/purchase", "/purchase/setup"].includes(page)) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== "drugmap-purchase" || typeof message.id !== "string") return;
    if (message.type === "ping") {
      window.postMessage({ source: "drugmap-extension", type: "pong", version: 6, id: message.id }, location.origin);
      return;
    }
    if (page !== "/purchase") return;
    if (!["search", "stage", "cart", "cartTotal"].includes(message.type) || !["yudan", "gaoi"].includes(message.supplier)) return;
    const validCode = message.type === "cartTotal" || (message.type === "search" ? /^[A-Z0-9]{5,10}$/.test(message.code) : /^[A-Z0-9]{10}(?:-[A-Z0-9]{1,10})?$/.test(message.code));
    if (!validCode) return;
    const request = message.type === "cartTotal" ? { type: "cartTotal", supplier: message.supplier } : message.type === "search" ? { type: "search", code: message.code, supplier: message.supplier } : { type: message.type, code: message.code, supplier: message.supplier, name: message.name, unit: message.unit, price: message.price, quantity: message.quantity };
    chrome.runtime.sendMessage(request, (result) => {
      const error = chrome.runtime.lastError;
      window.postMessage({ source: "drugmap-extension", type: "result", id: message.id, result: error ? { status: message.type === "cart" ? "uncertain" : "error", message: message.type === "cart" ? "無法確認購物車結果；請先檢查中盤購物車，避免重複。" : "連接工具無法回應，請重新整理頁面。" } : result }, location.origin);
    });
  });
}

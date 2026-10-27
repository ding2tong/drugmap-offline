export type SupplierKey = "yudan" | "gaoi";
export type SupplierOffer = { code: string; name: string; price: number; unit: string; stock: string };
export type SearchResult = { status: "ok"; offers: SupplierOffer[]; paginated: boolean; checkedAt: string } | { status: "login" | "unavailable" | "error"; message: string };
export type CartTotalResult = { status: "ok"; total: number; checkedAt: string } | { status: "login" | "unavailable" | "error"; message: string };

export function requestCartTotal(supplier: SupplierKey): Promise<CartTotalResult> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish({ status: "unavailable", message: "連接逾時，請重新整理中盤與採購頁。" }), 15000);
    function finish(result: CartTotalResult) { window.clearTimeout(timeout); window.removeEventListener("message", receive); resolve(result); }
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "drugmap-extension" || event.data?.type !== "result" || event.data?.id !== id) return;
      const value = event.data.result;
      if (value?.status === "ok" && typeof value.total === "number" && Number.isFinite(value.total) && value.total >= 0 && typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt))) return finish({ status: "ok", total: value.total, checkedAt: value.checkedAt });
      if (["login", "unavailable", "error"].includes(value?.status) && typeof value.message === "string") return finish({ status: value.status, message: value.message });
      finish({ status: "error", message: "無法辨識中盤購物車金額。" });
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "drugmap-purchase", type: "cartTotal", id, supplier }, window.location.origin);
  });
}

export function addSupplierCart(supplier: SupplierKey, offer: SupplierOffer, quantity: number): Promise<{ status: "ok" | "login" | "error" | "uncertain"; message: string }> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish({ status: "uncertain", message: "等待中盤回應逾時；請先核對購物車，避免重複加入。" }), 30000);
    function finish(result: { status: "ok" | "login" | "error" | "uncertain"; message: string }) { window.clearTimeout(timeout); window.removeEventListener("message", receive); resolve(result); }
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "drugmap-extension" || event.data?.type !== "result" || event.data?.id !== id) return;
      const value = event.data.result;
      if (!value || !["ok", "login", "error", "uncertain"].includes(value.status) || typeof value.message !== "string") return finish({ status: "uncertain", message: "無法確認中盤結果；請先核對購物車，避免重複加入。" });
      finish(value);
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "drugmap-purchase", type: "cart", id, supplier, code: offer.code, name: offer.name, unit: offer.unit, price: offer.price, quantity }, window.location.origin);
  });
}

export function openSupplierWithQuantity(supplier: SupplierKey, offer: SupplierOffer, quantity: number): Promise<{ status: "ok" | "login" | "error"; message: string }> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish({ status: "error", message: "帶入逾時，請到中盤頁面手動核對。" }), 25000);
    function finish(result: { status: "ok" | "login" | "error"; message: string }) { window.clearTimeout(timeout); window.removeEventListener("message", receive); resolve(result); }
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "drugmap-extension" || event.data?.type !== "result" || event.data?.id !== id) return;
      const value = event.data.result;
      if (!value || !["ok", "login", "error"].includes(value.status) || typeof value.message !== "string") return finish({ status: "error", message: "無法辨識帶入結果，請到中盤網站手動核對。" });
      finish(value);
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "drugmap-purchase", type: "stage", id, supplier, code: offer.code, name: offer.name, unit: offer.unit, price: offer.price, quantity }, window.location.origin);
  });
}

// The browser companion can search only fixed supplier sites, and returns no credentials.
export function requestSupplierSearch(code: string, supplier: SupplierKey): Promise<SearchResult> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish({ status: "unavailable", message: "未連接採購查詢工具，請確認工具已啟用並重新整理此頁。" }), 15000);
    function finish(result: SearchResult) { window.clearTimeout(timeout); window.removeEventListener("message", receive); resolve(result); }
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "drugmap-extension" || event.data?.type !== "result" || event.data?.id !== id) return;
      const value = event.data.result;
      if (!value || typeof value !== "object") return finish({ status: "error", message: "收到無法辨識的查詢結果。" });
      if (["login", "unavailable", "error"].includes(value.status) && typeof value.message === "string") return finish({ status: value.status, message: value.message });
      if (value.status !== "ok" || !Array.isArray(value.offers) || typeof value.checkedAt !== "string" || typeof value.paginated !== "boolean") return finish({ status: "error", message: "收到無法辨識的查詢結果。" });
      const offers: SupplierOffer[] = value.offers.filter((offer: SupplierOffer) => offer && typeof offer.code === "string" && offer.code.includes(code) && typeof offer.name === "string" && typeof offer.unit === "string" && offer.unit.trim() && typeof offer.stock === "string" && typeof offer.price === "number" && Number.isFinite(offer.price) && offer.price >= 0);
      if (offers.length !== value.offers.length) return finish({ status: "error", message: "搜尋結果包含無法辨識的資料，請至中盤網站核對。" });
      finish({ status: "ok", offers, paginated: value.paginated, checkedAt: value.checkedAt });
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "drugmap-purchase", type: "search", id, code, supplier }, window.location.origin);
  });
}

export function checkPurchaseBridge(): Promise<boolean> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish(false), 1500);
    function finish(available: boolean) { clearTimeout(timeout); window.removeEventListener("message", receive); resolve(available); }
    function receive(event: MessageEvent) { if (event.source === window && event.origin === window.location.origin && event.data?.source === "drugmap-extension" && event.data?.type === "pong" && event.data?.id === id && event.data?.version === 6) finish(true); }
    window.addEventListener("message", receive);
    window.postMessage({ source: "drugmap-purchase", type: "ping", id }, window.location.origin);
  });
}

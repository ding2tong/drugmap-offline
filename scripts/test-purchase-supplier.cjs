/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the supplier adapter against small representative DOM fixtures.
function element(text = "", children = {}, attributes = {}) {
  return { textContent: text, querySelector: (selector) => children[selector] || null, getAttribute: (key) => attributes[key] || null };
}
function fixture(supplier, options = {}) {
  const code = options.code || "AC150781G0";
  const input = { id: "shop_pc_2_662", value: options.inputValue || "", disabled: false, readOnly: false, dispatchEvent() {}, getAttribute: (name) => name === "name" ? "prod_list[AC150781G0_59110637_A][cart_qty]" : null };
  let cells;
  if (supplier === "yudan") {
    cells = [element(), element("", { span: element(code) }), element("", { a: element("敵芬尼朵 25MG") }), element(`$1,150元/ 盒 庫存數量: ${options.stock || "供貨中"} 加入追蹤`), element("", { 'input[type="text"], input[type="TEXT"]': input })];
  } else {
    cells = [element(), element("", { h4: element(code), img: element("", {}, { "data-source": "/public/example.jpg" }) }), element("", { ".pname": element("敵芬尼朵 25MG") }), element("", { ".product-price": element(options.missingPrice ? "" : "12"), ".pname": element("NT$ 12 / 排") }), element("", { "input.product-num": input }), element(), element(options.stock || "供貨中"), element()];
  }
  const row = { querySelectorAll: (selector) => selector === ":scope > td" ? cells : [] };
  return { input,
    body: element(supplier === "gaoi" ? `${options.loggedOut ? "" : "您好"} 以下為您以 AC150781 為關鍵字所查詢的產品列表` : ""),
    querySelector: (selector) => selector === "form#FORM1" && supplier === "yudan" ? element("", {}, { action: "/yudan_web_wt/index.php?prog=prod_list", method: "POST" }) : selector === ".loginnames" && supplier === "gaoi" && !options.loggedOut ? element("您好") : null,
    querySelectorAll: (selector) => {
      if (selector === "a") return supplier === "yudan" && !options.loggedOut ? [element("會員登出")] : [];
      if (selector === "form#FORM1 tr" || selector === "tr.product-ckb") return options.empty ? [] : [row];
      return [];
    },
  };
}
async function runCart(supplier, options = {}) {
  const doc = fixture(supplier, options);
  const calls = [];
  let cartReads = 0;
  const cartDoc = (quantity) => {
    const row = { textContent: quantity === -1 ? "AC999999G0 其他藥品" : quantity === -2 ? "其他藥品（代碼未顯示）" : "AC150781G0 敵芬尼朵", querySelectorAll: (selector) => selector === "div, span" ? [element("盒")] : selector === "input" ? [{ name: "cart_qty", value: String(quantity < 0 ? 1 : quantity) }] : [] };
    const list = { textContent: quantity === 0 ? "尚無選購的品項" : row.textContent, querySelectorAll: (selector) => quantity === 0 ? [] : selector === ".row" ? [row] : selector === "input" ? row.querySelectorAll("input") : [] };
    return { querySelectorAll: () => [element("會員登出")], querySelector: (selector) => selector === ".list_table" ? list : null };
  };
  const origin = supplier === "yudan" ? "http://www.yudan.com.tw" : "https://www.gaoipharma.com.tw";
  const context = vm.createContext({ location: { hostname: new URL(origin).hostname, origin }, chrome: { runtime: { id: "test", onMessage: { addListener() {} } } }, URL, URLSearchParams, Date,
    fetch: async (url, init = {}) => { calls.push({ url, init }); if (init.method === "POST" && options.postFails) throw Error("network"); return { ok: !(init.method === "POST" && options.postRedirect), type: init.method === "POST" && options.postRedirect ? "opaqueredirect" : "basic", text: async () => init.method === "POST" && supplier === "gaoi" ? JSON.stringify({ code: options.reject ? "99" : "00", msg: "測試" }) : url.includes("shop_cart") && options.cartSnapshots ? `cart:${options.cartSnapshots[cartReads++]}` : "fixture" }; },
    DOMParser: class { parseFromString(value) { return value.startsWith("cart:") ? cartDoc(Number(value.slice(5))) : doc; } },
  });
  vm.runInContext(fs.readFileSync("browser-extension/supplier.js", "utf8"), context);
  const request = { code: options.code || "AC150781G0", name: "敵芬尼朵 25MG", unit: supplier === "yudan" ? "盒" : "排", price: supplier === "yudan" ? 1150 : 12, quantity: 3 };
  return { result: await vm.runInContext(`addCart(${JSON.stringify(request)})`, context), calls };
}
async function run(supplier, options, code = "AC150781") {
  const doc = fixture(supplier, options);
  const context = vm.createContext({
    location: { hostname: supplier === "yudan" ? "www.yudan.com.tw" : "www.gaoipharma.com.tw", href: supplier === "yudan" ? "http://www.yudan.com.tw/yudan_web_wt/index.php?get_prod_medicine=AC150781G0" : "https://www.gaoipharma.com.tw/product.html?keys=AC150781G0" },
    chrome: { runtime: { id: "test", onMessage: { addListener() {} } } },
    fetch: async () => ({ ok: true, text: async () => "fixture" }),
    DOMParser: class { parseFromString() { return doc; } },
    URL, Date, Event,
  });
  vm.runInContext(fs.readFileSync("browser-extension/supplier.js", "utf8"), context);
  return vm.runInContext(`search(${JSON.stringify(code)})`, context);
}
function runStage(supplier, options, overrides = {}) {
  const doc = fixture(supplier, options);
  const context = vm.createContext({ document: doc, location: { hostname: supplier === "yudan" ? "www.yudan.com.tw" : "www.gaoipharma.com.tw", href: supplier === "yudan" ? "http://www.yudan.com.tw/yudan_web_wt/index.php?get_prod_medicine=AC150781G0" : "https://www.gaoipharma.com.tw/product.html?keys=AC150781G0" }, chrome: { runtime: { id: "test", onMessage: { addListener() {} } } }, URL, Event });
  vm.runInContext(fs.readFileSync("browser-extension/supplier.js", "utf8"), context);
  const request = { code: "AC150781G0", name: "敵芬尼朵 25MG", unit: supplier === "yudan" ? "盒" : "排", price: supplier === "yudan" ? 1150 : 12, quantity: 3, ...overrides };
  return { result: vm.runInContext(`stage(${JSON.stringify(request)})`, context), input: doc.input };
}
async function runTotal(supplier, options = {}) {
  const totalNode = element(options.amount ?? "0");
  const doc = {
    querySelector(selector) {
      if (selector === ".loginnames" && !options.loggedOut) return element("您好");
      if (selector === "#Alltotal") return options.missing ? null : totalNode;
      if (selector === ".list_table") return element(options.empty ? "尚無選購的品項" : "商品清單");
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a") return options.loggedOut ? [] : [element("會員登出")];
      if (selector === ".td2") return options.missing ? [] : [element(`金額總計： ${options.amount ?? "1,234"} 元`)];
      return [];
    },
  };
  const context = vm.createContext({ location: { hostname: supplier === "yudan" ? "www.yudan.com.tw" : "www.gaoipharma.com.tw" }, chrome: { runtime: { id: "test", onMessage: { addListener() {} } } }, fetch: async () => ({ ok: !options.networkError, text: async () => "fixture" }), DOMParser: class { parseFromString() { return doc; } }, Date });
  vm.runInContext(fs.readFileSync("browser-extension/supplier.js", "utf8"), context);
  return vm.runInContext("readCartTotal()", context);
}
(async () => {
  assert.equal((await runTotal("gaoi", { amount: "1,234" })).total, 1234);
  assert.equal((await runTotal("gaoi", { amount: "0" })).total, 0);
  assert.equal((await runTotal("yudan", { amount: "1,234" })).total, 1234);
  assert.equal((await runTotal("yudan", { empty: true })).total, 0);
  for (const supplier of ["gaoi", "yudan"]) {
    assert.equal((await runTotal(supplier, { loggedOut: true })).status, "login");
    assert.equal((await runTotal(supplier, { missing: true })).status, "error");
    assert.equal((await runTotal(supplier, { amount: "unknown" })).status, "error");
    assert.equal((await runTotal(supplier, { networkError: true })).status, "error");
  }
  const yudan = await run("yudan", {});
  assert.equal(yudan.status, "ok"); assert.equal(yudan.offers[0].price, 1150); assert.equal(yudan.offers[0].unit, "盒");
  const gaoi = await run("gaoi", {});
  assert.equal(gaoi.status, "ok"); assert.equal(gaoi.offers[0].price, 12); assert.equal(gaoi.offers[0].unit, "排");
  assert.equal((await run("gaoi", {}, "15078")).offers[0].code, "AC150781G0");
  assert.equal((await run("yudan", {}, "15078")).offers[0].code, "AC150781G0");
  assert.equal((await run("gaoi", { missingPrice: true })).status, "error");
  assert.equal((await run("yudan", { loggedOut: true })).status, "login");
  assert.equal((await run("gaoi", { loggedOut: true })).status, "login");
  assert.equal((await run("gaoi", { empty: true })).offers.length, 0);
  assert.equal((await run("gaoi", { code: "AC999999G0" })).offers.length, 0);
  for (const supplier of ["yudan", "gaoi"]) {
    const staged = runStage(supplier, {});
    assert.equal(staged.result.status, "ok"); assert.equal(staged.input.value, "3");
    const numbered = runStage(supplier, { stock: supplier === "yudan" ? "10 (盒)" : "10 (排)" });
    assert.equal(numbered.result.status, "ok"); assert.equal(numbered.input.value, "3");
    for (const [options, overrides] of [[{}, { price: 999 }], [{}, { code: "AC15078100" }], [{}, { unit: "瓶" }], [{}, { quantity: 1.5 }], [{ stock: "缺貨" }, {}], [{ stock: "請洽詢" }, {}], [{ stock: "2 (盒)" }, {}], [{ stock: "100 (瓶)" }, {}], [{ inputValue: "2" }, {}], [{ loggedOut: true }, {}]]) {
      const blocked = runStage(supplier, options, overrides);
      assert.notEqual(blocked.result.status, "ok");
      assert.equal(blocked.input.value, options.inputValue || "");
    }
  }
  const gaoiCart = await runCart("gaoi");
  assert.equal(gaoiCart.result.status, "ok"); assert.equal(gaoiCart.calls.length, 2);
  assert.equal((await runCart("gaoi", { code: "AC61020100-1" })).result.status, "ok");
  assert.equal(gaoiCart.calls[1].url, "/common/add_cart.html");
  assert.equal(new URLSearchParams(gaoiCart.calls[1].init.body).get("num"), "3");
  const yudanCart = await runCart("yudan");
  assert.equal(yudanCart.result.status, "uncertain"); assert.equal(yudanCart.calls.length, 4);
  const yudanPost = yudanCart.calls.find((call) => call.init.method === "POST");
  assert.equal(new URLSearchParams(yudanPost.init.body).get("prod_list[AC150781G0_59110637_A][cart_qty]"), "3");
  assert.equal((await runCart("yudan", { cartSnapshots: [0, 3] })).result.status, "ok");
  assert.equal((await runCart("yudan", { cartSnapshots: [0, 3], postRedirect: true })).result.status, "ok");
  assert.equal((await runCart("yudan", { cartSnapshots: [-1, 3] })).result.status, "ok");
  assert.equal((await runCart("yudan", { cartSnapshots: [-2, 3] })).result.status, "uncertain");
  assert.equal((await runCart("yudan", { cartSnapshots: [0, 2] })).result.status, "uncertain");
  const unavailable = await runCart("gaoi", { stock: "缺貨" });
  assert.equal(unavailable.result.status, "error"); assert.equal(unavailable.calls.length, 1);
  assert.equal((await runCart("gaoi", { postFails: true })).result.status, "uncertain");
  assert.equal((await runCart("gaoi", { reject: true })).result.status, "error");
  console.log("Supplier adapter fixtures passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

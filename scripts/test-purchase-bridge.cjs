/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let handler;
let lastQuery;
let createdUrl;
let tabs = [];
let messages = [];
let failAfterDispatch = false;
const chrome = {
  runtime: { onMessage: { addListener(fn) { handler = fn; } } },
  tabs: {
    query(query, callback) { lastQuery = query; callback(tabs); },
    create(options, callback) { createdUrl = options.url; callback({ id: 2 }); },
    get(id, callback) { callback({ id, status: "complete" }); },
    onUpdated: { addListener() {}, removeListener() {} },
    async sendMessage(id, message) { messages.push({ id, type: message.type }); if (id === 1) throw Error("no receiver"); if (message.type === "health") return { status: "ready", version: 6 }; if (message.type === "cart" && failAfterDispatch) throw Error("connection lost after dispatch"); return { status: "ok", code: message.code }; },
  },
};
vm.runInNewContext(fs.readFileSync("browser-extension/background.js", "utf8"), { chrome, URL, setTimeout, clearTimeout });
const request = (senderUrl, code = "AC150781", supplier = "yudan") => new Promise((resolve) => {
  const keepOpen = handler({ type: "search", code, supplier }, { url: senderUrl }, resolve);
  if (!keepOpen) resolve(null);
});
(async () => {
  assert.equal(await request("https://example.com/purchase"), null);
  assert.equal(await request("https://chencheng-drugmap.web.app/purchase"), null);
  assert.equal(await request("http://127.0.0.1:3211/purchase"), null);
  assert.equal(await request("http://127.0.0.1:3210/purchase/setup"), null);
  assert.equal(await request("http://127.0.0.1:3210/other"), null);
  assert.equal(await request("http://127.0.0.1:3210/purchase", "../../oops"), null);
  assert.equal(await request("http://127.0.0.1:3210/purchase", "AC150781", "other"), null);
  assert.equal((await request("http://127.0.0.1:3210/purchase")).status, "unavailable");
  assert.equal(lastQuery.url, "http://www.yudan.com.tw/yudan_web_wt/*");
  tabs = [{ id: 1 }, { id: 2 }];
  const result = await request("http://127.0.0.1:3210/purchase", "AC150781", "gaoi");
  assert.equal(result.status, "ok"); assert.equal(result.code, "AC150781");
  assert.equal(lastQuery.url, "https://www.gaoipharma.com.tw/*");
  const staged = await new Promise((resolve) => {
    const keepOpen = handler({ type: "stage", code: "AC150781G0", supplier: "gaoi", name: "藥品", unit: "排", price: 12, quantity: 3 }, { url: "http://127.0.0.1:3210/purchase" }, resolve);
    assert.equal(keepOpen, true);
  });
  assert.equal(staged.status, "ok");
  assert.equal(createdUrl, "https://www.gaoipharma.com.tw/product.html?keys=AC150781G0");
  createdUrl = undefined;
  assert.equal(handler({ type: "stage", code: "AC150781G0", supplier: "gaoi", name: "藥品", unit: "排", price: 12, quantity: -1 }, { url: "http://127.0.0.1:3210/purchase" }, () => {}), undefined);
  assert.equal(createdUrl, undefined);
  const cartRequest = { type: "cart", code: "AC150781G0", supplier: "gaoi", name: "藥品", unit: "排", price: 12, quantity: 3 };
  messages = [];
  const recovered = await new Promise((resolve) => handler(cartRequest, { url: "http://127.0.0.1:3210/purchase" }, resolve));
  assert.equal(recovered.status, "ok");
  assert.deepEqual(messages.filter((entry) => entry.type === "cart").map((entry) => entry.id), [2]);
  failAfterDispatch = true; messages = [];
  const uncertain = await new Promise((resolve) => handler(cartRequest, { url: "http://127.0.0.1:3210/purchase" }, resolve));
  assert.equal(uncertain.status, "uncertain");
  assert.equal(messages.filter((entry) => entry.type === "cart").length, 1);
  failAfterDispatch = false;
  tabs = [{ id: 2 }];
  const cartResult = await new Promise((resolve) => handler(cartRequest, { url: "http://127.0.0.1:3210/purchase" }, resolve));
  assert.equal(cartResult.status, "ok");
  const variantRequest = { ...cartRequest, code: "AC61020100-1" };
  const variantResult = await new Promise((resolve) => {
    if (!handler(variantRequest, { url: "http://127.0.0.1:3210/purchase" }, resolve)) resolve(null);
  });
  assert.equal(variantResult?.status, "ok");
  messages = [];
  const totalResult = await new Promise((resolve) => handler({ type: "cartTotal", supplier: "gaoi" }, { url: "http://127.0.0.1:3210/purchase" }, resolve));
  assert.equal(totalResult.status, "ok");
  assert.equal(messages.filter((entry) => entry.type === "cartTotal").length, 1);
  assert.equal(handler({ type: "cartTotal", supplier: "gaoi" }, { url: "https://example.com/purchase" }, () => {}), undefined);
  console.log("Purchase bridge routing fixtures passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

const ext = globalThis.browser || chrome;
const summary = document.querySelector("#summary");
const recentProducts = document.querySelector("#recent-products");
const openOptions = document.querySelector("#open-options");

document.addEventListener("DOMContentLoaded", async () => {
  const [{ lastRun, recentProducts: products = [] }, { settings = {} }] = await Promise.all([
    ext.storage.local.get(["lastRun", "recentProducts"]),
    ext.storage.local.get("settings")
  ]);
  if (!lastRun) {
    summary.textContent = "まだ実行されていません。";
  } else {
    const checkedAt = new Date(lastRun.checkedAt).toLocaleString();
    const runSummary = lastRun.summary || {};
    const browserMode = settings.browserNotificationMode === "perProduct" ? "商品ごと" : "集約";
    const browserCount =
      runSummary.browserNotificationCount ??
      (browserMode === "集約" ? (runSummary.browserNotifiedCount ? 1 : 0) : runSummary.browserNotifiedCount ?? 0);
    summary.textContent = `${checkedAt}: ${lastRun.status} / 新規${runSummary.newCount ?? 0}件 / Discord ${runSummary.discordNotifiedCount ?? lastRun.notifiedCount}件 / Browser ${browserCount}件（${browserMode}）`;
  }

  renderRecentProducts(products);
  await ext.runtime.sendMessage({ type: "CLEAR_BADGE" });
});

openOptions.addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});

function renderRecentProducts(products) {
  if (products.length === 0) {
    recentProducts.textContent = "新商品履歴はまだありません。";
    return;
  }

  recentProducts.replaceChildren(
    ...products.map((product) => {
      const link = document.createElement("a");
      link.className = "recent-product";
      link.href = product.url;
      link.target = "_blank";
      link.rel = "noreferrer";

      const title = document.createElement("span");
      title.className = "recent-product-title";
      title.textContent = product.title;

      const meta = document.createElement("span");
      meta.className = "recent-product-meta";
      meta.textContent = `${product.price} / ${product.tag}`;

      link.append(title, meta);
      return link;
    })
  );
}

const ext = globalThis.browser || chrome;
const DEFAULT_RECENT_PRODUCTS_LIMIT = 100;
const STALE_RUNNING_AFTER_MS = 30 * 60 * 1000;
const summary = document.querySelector("#summary");
const recentProducts = document.querySelector("#recent-products");
const openOptions = document.querySelector("#open-options");

document.addEventListener("DOMContentLoaded", async () => {
  const {
    lastRun: storedLastRun,
    recentProducts: products = [],
    settings = {}
  } = await ext.storage.local.get(["lastRun", "recentProducts", "settings"]);
  const lastRun = await normalizeStoredLastRun(storedLastRun);
  const recentProductsLimit = normalizeRecentProductsLimit(settings.recentProductsLimit);

  if (!lastRun) {
    summary.textContent = "まだ実行されていません。";
  } else {
    const checkedAt = new Date(lastRun.checkedAt).toLocaleString();
    const runSummary = lastRun.summary || {};
    const adultBlockedText = runSummary.adultSearchBlockedCount > 0
      ? ` / 成人向け検索不可 ${runSummary.adultSearchBlockedCount} タグ`
      : "";
    summary.textContent = `${checkedAt}: ${formatStatus(lastRun.status)} / 新規 ${runSummary.newCount ?? 0} 件 / Discord通知 ${runSummary.discordNotifiedCount ?? 0} 件 / 一覧追加 ${lastRun.notifiedCount ?? 0} 件${adultBlockedText}`;
  }

  renderRecentProducts(products.slice(0, recentProductsLimit));
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

      const titleRow = document.createElement("span");
      titleRow.className = "recent-product-title-row";

      const title = document.createElement("span");
      title.className = "recent-product-title";
      title.textContent = product.title;

      titleRow.append(title);

      if (product.isAdult) {
        const badge = document.createElement("span");
        badge.className = "recent-product-badge recent-product-badge-adult";
        badge.textContent = "成人向け";
        titleRow.append(badge);
      }

      const meta = document.createElement("span");
      meta.className = "recent-product-meta";
      meta.textContent = `${product.price} / ${product.tag}`;

      link.append(titleRow, meta);
      return link;
    })
  );
}

function formatStatus(status) {
  switch (status) {
    case "ok":
      return "正常";
    case "error":
      return "エラー";
    case "skipped":
      return "未実行";
    case "running":
      return "実行中";
    default:
      return status || "不明";
  }
}

function normalizeRecentProductsLimit(value) {
  const productsLimit = Number(value) || DEFAULT_RECENT_PRODUCTS_LIMIT;
  return Math.min(500, Math.max(20, Math.floor(productsLimit)));
}

async function normalizeStoredLastRun(lastRun) {
  const normalizedLastRun = normalizeLastRun(lastRun);
  if (normalizedLastRun !== lastRun) {
    await ext.storage.local.set({ lastRun: normalizedLastRun });
  }
  return normalizedLastRun;
}

function normalizeLastRun(lastRun) {
  if (!isStaleRunningRun(lastRun)) {
    return lastRun;
  }

  return {
    ...lastRun,
    status: "error",
    interrupted: true,
    interruptedAt: new Date().toISOString(),
    message: appendRunMessage(
      lastRun.message,
      "前回の実行は完了前に中断された可能性があります。再実行してください。"
    )
  };
}

function isStaleRunningRun(lastRun) {
  if (lastRun?.status !== "running") {
    return false;
  }

  const checkedAt = Date.parse(lastRun.checkedAt);
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > STALE_RUNNING_AFTER_MS;
}

function appendRunMessage(currentMessage, nextMessage) {
  return [currentMessage, nextMessage]
    .filter(Boolean)
    .join("\n");
}

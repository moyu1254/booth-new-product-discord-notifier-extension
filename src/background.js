const ALARM_NAME = "booth-product-check";
if (typeof importScripts === "function") {
  importScripts("product-parser.js");
}

const ext = globalThis.browser || chrome;
const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: false,
  browserNotificationMode: "summary",
  notifyBrowser: true,
  notifyDiscord: true,
  skipInitialExistingProducts: true
};
const NOTIFICATION_ICON_URL = ext.runtime.getURL("icons/notification-128.png");

ext.runtime.onInstalled.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "installed" });
});

ext.runtime.onStartup.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "startup" });
});

ext.notifications.onClicked.addListener(async (notificationId) => {
  const { notificationLinks } = await ext.storage.local.get("notificationLinks");
  const url = notificationLinks?.[notificationId];
  if (url) {
    await ext.tabs.create({ url });
  }
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck({ reason: "alarm" });
  }
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLEAR_BADGE") {
    clearBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type !== "RUN_CHECK_NOW") {
    return false;
  }

  runCheck({ reason: "manual" })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, message: error.message }));

  return true;
});

ext.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "local" || areaName === "sync") && changes.settings) {
    scheduleChecks();
  }
});

async function scheduleChecks() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(1, Number(settings.checkIntervalMinutes) || 30);

  await ext.alarms.clear(ALARM_NAME);
  await ext.alarms.create(ALARM_NAME, { periodInMinutes });
}

async function runCheck({ reason } = {}) {
  const settings = await getSettings();
  const webhookUrl = settings.discordWebhookUrl.trim();
  const tags = normalizeTags(settings.boothTags);
  const { monitorInitialized = false } = await ext.storage.local.get("monitorInitialized");
  const shouldBootstrapOnly = settings.skipInitialExistingProducts && !monitorInitialized;

  if (tags.length === 0 || (!settings.notifyDiscord && !settings.notifyBrowser)) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "BOOTH tags or notification destinations are not configured.",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  if (settings.notifyDiscord && !webhookUrl) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord notification is enabled, but Webhook URL is not configured.",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  if (settings.notifyDiscord && !isDiscordWebhookUrl(webhookUrl)) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Discord Webhook URL must start with https://discord.com/api/webhooks/.",
      notifiedCount: 0,
      summary: emptySummary(),
      tags: []
    });
    return;
  }

  const seenIds = await getSeenProductIds();
  let notifiedCount = 0;
  const errors = [];
  const browserNotificationErrors = [];
  const browserSummaryItems = [];
  const newlySeenProducts = [];
  const tagResults = [];
  const summary = emptySummary();

  for (const tag of tags) {
    const tagResult = {
      tag,
      fetchedCount: 0,
      newCount: 0,
      discordNotifiedCount: 0,
      discordFailedCount: 0,
      browserNotifiedCount: 0,
      browserFailedCount: 0,
      sourceUrl: "",
      fallbackFromUrl: "",
      adultSearchFallback: false,
      bootstrappedCount: 0
    };

    try {
      const { products, sourceUrl, fallbackFromUrl, adultSearchFallback } = await fetchProductsByTag(
        tag,
        settings.includeAdult
      );
      tagResult.sourceUrl = sourceUrl;
      tagResult.fallbackFromUrl = fallbackFromUrl;
      tagResult.adultSearchFallback = adultSearchFallback;
      tagResult.fetchedCount = products.length;
      summary.fetchedCount += products.length;

      if (adultSearchFallback) {
        summary.adultSearchFallbackCount += 1;
      }

      if (shouldBootstrapOnly) {
        const unseenProducts = products.filter((product) => !seenIds.includes(product.id));
        for (const product of unseenProducts) {
          seenIds.push(product.id);
        }
        tagResult.bootstrappedCount = unseenProducts.length;
        summary.bootstrappedCount += unseenProducts.length;
        await sleep(2000);
        tagResults.push(tagResult);
        continue;
      }

      for (const product of products) {
        if (seenIds.includes(product.id)) {
          continue;
        }

        tagResult.newCount += 1;
        summary.newCount += 1;

        const discordNotified = settings.notifyDiscord
          ? await sendDiscordNotification(webhookUrl, product, tag)
          : false;
        let browserNotified = { ok: false, message: "" };
        if (settings.notifyBrowser && settings.browserNotificationMode === "perProduct") {
          browserNotified = await sendBrowserNotification(product, tag);
        } else if (settings.notifyBrowser) {
          browserSummaryItems.push({ product, tag, tagResult });
          browserNotified = { ok: true, message: "", pendingSummary: true };
        }

        if (discordNotified) {
          tagResult.discordNotifiedCount += 1;
          summary.discordNotifiedCount += 1;
        }

        if (settings.notifyDiscord && !discordNotified) {
          tagResult.discordFailedCount += 1;
          summary.discordFailedCount += 1;
        }

        if (browserNotified.ok && !browserNotified.pendingSummary) {
          tagResult.browserNotifiedCount += 1;
          summary.browserNotifiedCount += 1;
          summary.browserNotificationCount += 1;
        }

        if (settings.notifyBrowser && !browserNotified.ok) {
          tagResult.browserFailedCount += 1;
          summary.browserFailedCount += 1;
          if (browserNotified.message) {
            browserNotificationErrors.push(browserNotified.message);
          }
        }

        if (discordNotified || (browserNotified.ok && !browserNotified.pendingSummary)) {
          seenIds.push(product.id);
          newlySeenProducts.push({ ...product, tag, detectedAt: new Date().toISOString() });
          notifiedCount += 1;
          await sleep(1000);
        }
      }

      await sleep(2000);
    } catch (error) {
      errors.push(`${tag}: ${error.message}`);
    }

    tagResults.push(tagResult);
  }

  if (settings.notifyBrowser && settings.browserNotificationMode === "summary") {
    const browserSummary = await sendBrowserSummaryNotification(browserSummaryItems);
    if (browserSummary.ok) {
      if (browserSummaryItems.length > 0) {
        summary.browserNotificationCount += 1;
      }
      for (const item of browserSummaryItems) {
        item.tagResult.browserNotifiedCount += 1;
        summary.browserNotifiedCount += 1;
        if (!seenIds.includes(item.product.id)) {
          seenIds.push(item.product.id);
          newlySeenProducts.push({
            ...item.product,
            tag: item.tag,
            detectedAt: new Date().toISOString()
          });
          notifiedCount += 1;
        }
      }
    } else if (browserSummaryItems.length > 0) {
      summary.browserFailedCount += 1;
      for (const item of browserSummaryItems) {
        item.tagResult.browserFailedCount += 1;
      }
      if (browserSummary.message) {
        browserNotificationErrors.push(browserSummary.message);
      }
    }
  }

  await ext.storage.local.set({ seenProductIds: unique(seenIds) });
  if (shouldBootstrapOnly) {
    await ext.storage.local.set({ monitorInitialized: true });
  }
  await saveRecentProducts(newlySeenProducts);
  await updateBadge();
  await setLastRun({
    checkedAt: new Date().toISOString(),
    reason,
    status:
      errors.length > 0 || summary.discordFailedCount > 0 || summary.browserFailedCount > 0
        ? "error"
        : "ok",
    message: buildRunMessage(errors, summary, browserNotificationErrors),
    notifiedCount,
    summary,
    tags: tagResults
  });
}

async function getSettings() {
  const [{ settings: localSettings }, { settings: syncedSettings }] = await Promise.all([
    ext.storage.local.get("settings"),
    ext.storage.sync.get("settings")
  ]);
  const settings = localSettings || syncedSettings || {};

  if (!localSettings && syncedSettings) {
    await ext.storage.local.set({ settings });
    await removeSyncedSettings();
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    boothTags: normalizeTags(settings?.boothTags)
  };
}

async function removeSyncedSettings() {
  try {
    await ext.storage.sync.remove("settings");
  } catch (error) {
    console.warn("Failed to remove synced settings.", error);
  }
}

async function getSeenProductIds() {
  const { seenProductIds } = await ext.storage.local.get("seenProductIds");
  return Array.isArray(seenProductIds) ? seenProductIds : [];
}

async function setLastRun(lastRun) {
  await ext.storage.local.set({ lastRun });
}

async function saveRecentProducts(products) {
  if (products.length === 0) {
    return;
  }

  const { recentProducts = [], unreadCount = 0 } = await ext.storage.local.get([
    "recentProducts",
    "unreadCount"
  ]);
  const merged = [...products, ...recentProducts.filter((product) => !products.some((p) => p.id === product.id))].slice(
    0,
    100
  );

  await ext.storage.local.set({
    recentProducts: merged,
    unreadCount: unreadCount + products.length
  });
}

async function fetchProductsByTag(tag, includeAdult) {
  const primaryResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, includeAdult));

  if (!includeAdult || primaryResult.products.length > 0) {
    return { ...primaryResult, adultSearchFallback: false };
  }

  const fallbackResult = await fetchProductsByTagUrl(buildBoothSearchUrl(tag, false));
  return {
    ...fallbackResult,
    fallbackFromUrl: primaryResult.sourceUrl,
    adultSearchFallback: true
  };
}

async function fetchProductsByTagUrl(sourceUrl) {
  const response = await fetch(sourceUrl, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`BOOTH responded with ${response.status}`);
  }

  const html = await response.text();
  const products = await parseProductsInOffscreenDocument(html);
  return { products, sourceUrl, fallbackFromUrl: "" };
}

function buildBoothSearchUrl(tag, includeAdult) {
  const params = new URLSearchParams();
  params.set("sort", "new");
  params.append("tags[]", tag);

  if (includeAdult) {
    params.set("adult", "include");
  }

  return `https://booth.pm/ja/items?${params.toString()}`;
}

async function sendDiscordNotification(webhookUrl, product, tag) {
  const embed = {
    title: product.title.slice(0, 256),
    url: product.url,
    color: 0xff6fae,
    fields: [
      { name: "価格", value: product.price.slice(0, 1024), inline: true },
      { name: "タグ", value: tag.slice(0, 1024), inline: true }
    ],
    footer: { text: "BOOTH Monitor" }
  };

  if (product.imageUrl) {
    embed.thumbnail = { url: product.imageUrl };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "BOOTH通知Bot",
      embeds: [embed]
    })
  });

  return response.ok;
}

async function sendBrowserNotification(product, tag) {
  const notificationId = `booth-${product.id}-${Date.now()}`;

  const permission = await getBrowserNotificationPermissionLevel();
  if (permission !== "granted") {
    return { ok: false, message: `Notification permission is ${permission}.` };
  }

  try {
    await ext.notifications.create(notificationId, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON_URL,
      title: product.title,
      message: `${product.price} / ${tag}`,
      contextMessage: "BOOTH 商品ごと通知"
    });
    await saveNotificationLink(notificationId, product.url);
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: error?.message || "Unknown browser notification error." };
  }
}

async function sendBrowserSummaryNotification(items) {
  if (items.length === 0) {
    return { ok: true, message: "" };
  }

  const permission = await getBrowserNotificationPermissionLevel();
  if (permission !== "granted") {
    return { ok: false, message: `Notification permission is ${permission}.` };
  }

  const notificationId = `booth-summary-${Date.now()}`;
  const tagCounts = countBy(items, (item) => item.tag);
  const tagSummary = Object.entries(tagCounts)
    .map(([tag, count]) => `${tag}: ${count}`)
    .slice(0, 3)
    .join(" / ");
  const titlePreview = items
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.product.title.slice(0, 32)} / ${item.tag}`)
    .join(" | ");
  const remainingCount = items.length - 3;
  const message =
    items.length === 1
      ? `${items[0].product.title} / ${items[0].price} / ${items[0].tag}`
      : `${titlePreview}${remainingCount > 0 ? ` ... 他${remainingCount}件` : ""}${tagSummary ? `\n${tagSummary}` : ""}`;

  try {
    await ext.notifications.create(notificationId, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON_URL,
      title: `BOOTH 集約通知 ${items.length}件`,
      message,
      contextMessage: "BOOTH 集約通知"
    });
    await saveNotificationLink(notificationId, items[0].product.url);
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: error?.message || "Unknown browser notification error." };
  }
}

async function getBrowserNotificationPermissionLevel() {
  try {
    return await ext.notifications.getPermissionLevel();
  } catch (error) {
    return "unknown";
  }
}

async function saveNotificationLink(notificationId, url) {
  const { notificationLinks } = await ext.storage.local.get("notificationLinks");
  await ext.storage.local.set({
    notificationLinks: {
      ...(notificationLinks || {}),
      [notificationId]: url
    }
  });
}

async function updateBadge() {
  const { unreadCount = 0 } = await ext.storage.local.get("unreadCount");
  await getActionApi().setBadgeBackgroundColor({ color: "#e75493" });
  await getActionApi().setBadgeText({
    text: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : ""
  });
}

async function clearBadge() {
  await ext.storage.local.set({ unreadCount: 0 });
  await getActionApi().setBadgeText({ text: "" });
}

async function parseProductsInOffscreenDocument(html) {
  if (typeof DOMParser !== "undefined") {
    return parseProductsFromHtml(html);
  }

  await ensureOffscreenDocument();
  const response = await ext.runtime.sendMessage({
    type: "PARSE_PRODUCTS",
    html
  });

  if (!response?.ok) {
    throw new Error(response?.message || "Failed to parse BOOTH products.");
  }

  return response.products;
}

async function ensureOffscreenDocument() {
  if (!ext.offscreen || !ext.runtime.getContexts) {
    throw new Error("DOMParser and offscreen documents are not available in this browser.");
  }

  const offscreenUrl = ext.runtime.getURL("src/offscreen.html");
  const contexts = await ext.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  await ext.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse BOOTH search result HTML in a DOM-capable extension context."
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function countBy(values, getKey) {
  return values.reduce((counts, value) => {
    const key = getKey(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function getActionApi() {
  return ext.action || ext.browserAction;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : [];

  return rawTags
    .flatMap((tag) => String(tag).split(/[\n,、]/))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isDiscordWebhookUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" &&
      parsedUrl.hostname === "discord.com" &&
      parsedUrl.pathname.startsWith("/api/webhooks/");
  } catch (error) {
    return false;
  }
}

function emptySummary() {
  return {
    fetchedCount: 0,
    newCount: 0,
    discordNotifiedCount: 0,
    discordFailedCount: 0,
    browserNotifiedCount: 0,
    browserNotificationCount: 0,
    browserFailedCount: 0,
    adultSearchFallbackCount: 0,
    bootstrappedCount: 0
  };
}

function buildRunMessage(errors, summary, browserNotificationErrors = []) {
  const messages = [...errors];

  if (summary.adultSearchFallbackCount > 0) {
    messages.push(
      `${summary.adultSearchFallbackCount} adult search(es) returned no products and fell back to normal search. Check BOOTH login and adult content settings.`
    );
  }

  if (summary.bootstrappedCount > 0) {
    messages.push(
      `${summary.bootstrappedCount} existing product(s) were marked as seen without notification.`
    );
  }

  if (summary.discordFailedCount > 0) {
    messages.push(`${summary.discordFailedCount} Discord notification(s) failed.`);
  }

  if (summary.browserFailedCount > 0) {
    const uniqueErrors = unique(browserNotificationErrors).slice(0, 3);
    const suffix = uniqueErrors.length > 0 ? `: ${uniqueErrors.join(" / ")}` : ".";
    messages.push(`${summary.browserFailedCount} browser notification(s) failed${suffix}`);
  }

  return messages.join("\n");
}

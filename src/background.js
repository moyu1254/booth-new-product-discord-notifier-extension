const ALARM_NAME = "booth-product-check";
const DEFAULT_SETTINGS = {
  boothTags: [],
  checkIntervalMinutes: 30,
  discordWebhookUrl: "",
  includeAdult: true
};

chrome.runtime.onInstalled.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "installed" });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleChecks();
  runCheck({ reason: "startup" });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck({ reason: "alarm" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_CHECK_NOW") {
    return false;
  }

  runCheck({ reason: "manual" })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, message: error.message }));

  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.settings) {
    scheduleChecks();
  }
});

async function scheduleChecks() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(1, Number(settings.checkIntervalMinutes) || 30);

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

async function runCheck({ reason } = {}) {
  const settings = await getSettings();
  const webhookUrl = settings.discordWebhookUrl.trim();
  const tags = settings.boothTags.map((tag) => tag.trim()).filter(Boolean);

  if (!webhookUrl || tags.length === 0) {
    await setLastRun({
      checkedAt: new Date().toISOString(),
      reason,
      status: "skipped",
      message: "Webhook URL or BOOTH tags are not configured.",
      notifiedCount: 0
    });
    return;
  }

  const seenIds = await getSeenProductIds();
  let notifiedCount = 0;
  const errors = [];

  for (const tag of tags) {
    try {
      const products = await fetchProductsByTag(tag, settings.includeAdult);

      for (const product of products) {
        if (seenIds.includes(product.id)) {
          continue;
        }

        const notified = await sendDiscordNotification(webhookUrl, product, tag);
        if (notified) {
          seenIds.push(product.id);
          notifiedCount += 1;
          await sleep(1000);
        }
      }

      await sleep(2000);
    } catch (error) {
      errors.push(`${tag}: ${error.message}`);
    }
  }

  await chrome.storage.local.set({ seenProductIds: unique(seenIds) });
  await setLastRun({
    checkedAt: new Date().toISOString(),
    reason,
    status: errors.length > 0 ? "error" : "ok",
    message: errors.join("\n"),
    notifiedCount
  });
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    boothTags: Array.isArray(settings?.boothTags) ? settings.boothTags : []
  };
}

async function getSeenProductIds() {
  const { seenProductIds } = await chrome.storage.local.get("seenProductIds");
  return Array.isArray(seenProductIds) ? seenProductIds : [];
}

async function setLastRun(lastRun) {
  await chrome.storage.local.set({ lastRun });
}

async function fetchProductsByTag(tag, includeAdult) {
  const params = new URLSearchParams();
  params.set("sort", "new");
  params.append("tags[]", tag);

  if (includeAdult) {
    params.set("adult", "include");
  }

  const response = await fetch(`https://booth.pm/ja/items?${params.toString()}`, {
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`BOOTH responded with ${response.status}`);
  }

  const html = await response.text();
  return parseProductsInOffscreenDocument(html);
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

  return response.status === 204;
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeImageUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

async function parseProductsInOffscreenDocument(html) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "PARSE_PRODUCTS",
    html
  });

  if (!response?.ok) {
    throw new Error(response?.message || "Failed to parse BOOTH products.");
  }

  return response.products;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("src/offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse BOOTH search result HTML in a DOM-capable extension context."
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

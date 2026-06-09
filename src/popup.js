const summary = document.querySelector("#summary");
const openOptions = document.querySelector("#open-options");

document.addEventListener("DOMContentLoaded", async () => {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  if (!lastRun) {
    summary.textContent = "まだ実行されていません。";
    return;
  }

  const checkedAt = new Date(lastRun.checkedAt).toLocaleString();
  summary.textContent = `${checkedAt}: ${lastRun.status} / ${lastRun.notifiedCount}件通知`;
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

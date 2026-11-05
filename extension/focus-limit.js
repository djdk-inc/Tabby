const token = location.hash.slice(1);
const status = document.querySelector("#status");

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, token, ...extra });
  if (!response.ok) throw new Error(response.error);
  return response;
}

async function load() {
  try {
    const { block } = await send("get-focus-block");
    document.querySelector("#domain").textContent = block.domain;
    document.querySelector("#blockedUrl").textContent = block.url;
    const list = document.querySelector("#existingTabs");
    list.innerHTML = "";
    for (const tab of block.existingTabs) {
      const button = document.createElement("button");
      button.textContent = tab.title || tab.url;
      button.title = tab.url;
      button.addEventListener("click", () => act("focus-existing", { tabId:tab.id }));
      list.append(button);
    }
    if (!block.existingTabs.length) list.textContent = "The earlier tabs are no longer open. You can open this URL anyway.";
  } catch (error) {
    status.textContent = error.message;
    document.querySelectorAll("button").forEach((button) => button.disabled = true);
  }
}

async function act(type, extra = {}) {
  status.textContent = "Working…";
  try {
    const response = await send(type, extra);
    if (type === "save-focus-block") {
      status.textContent = `Saved. Your library now has ${response.saved} tabs.`;
      document.querySelectorAll("button").forEach((button) => button.disabled = true);
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelector("#save").addEventListener("click", () => act("save-focus-block"));
document.querySelector("#allow").addEventListener("click", () => act("allow-focus-block"));
document.querySelector("#close").addEventListener("click", () => act("close-focus-block"));
load();

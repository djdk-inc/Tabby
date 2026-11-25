// An unpacked install reads its files from disk, so copying a newer version into the folder is
// visible here before Chrome reloads the extension. When the folder's manifest version differs
// from the running one, reload so the new version takes over without a click on chrome://extensions.
export async function reloadIfFolderUpdated() {
  try {
    const onDisk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    if (onDisk.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch {}
}

const launcherButton = document.getElementById("launcherButton");
const statusLine = document.getElementById("statusLine");

launcherButton.addEventListener("click", async () => {
  await window.electronAPI.openLauncher();
});

async function refreshPlaceholderStatus() {
  if (!window.electronAPI?.getServerStatus || !statusLine) {
    return;
  }

  try {
    const status = await window.electronAPI.getServerStatus();

    if (status?.running && status?.ready) {
      statusLine.textContent =
        `A web application is running at ${status.localUrl || "http://127.0.0.1"}.`;
    } else if (status?.running) {
      statusLine.textContent =
        "A server process is starting but is not responding yet.";
    } else {
      statusLine.textContent = "No web application is currently running.";
    }
  } catch {
    statusLine.textContent = "No web application is currently running.";
  }
}

if (window.electronAPI?.onServerStatus) {
  window.electronAPI.onServerStatus(() => {
    refreshPlaceholderStatus();
  });
}

refreshPlaceholderStatus();

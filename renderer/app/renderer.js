const launcherButton = document.getElementById("launcherButton");

launcherButton.addEventListener("click", async () => {
  await window.electronAPI.openLauncher();
});

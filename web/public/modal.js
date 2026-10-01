/*
|--------------------------------------------------------------------------
| Modal
|--------------------------------------------------------------------------
|
| Promise-based replacements for native alert / confirm / prompt.
| Matches the dark LAN Monitor theme (CSS variables in style.css).
|
*/

const Modal = (() => {
  let root = null;

  function ensureRoot() {
    if (root) return root;

    root = document.createElement("div");
    root.className = "modal-overlay hidden";
    root.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2 class="modal-title"></h2>
          <button type="button" class="btn-icon modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-message"></p>
          <input type="text" class="modal-input hidden" />
          <select class="modal-select hidden"></select>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary modal-cancel">Cancel</button>
          <button type="button" class="btn modal-ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  function show(opts) {
    ensureRoot();
    root.classList.remove("hidden");

    root.querySelector(".modal-title").textContent = opts.title || "";
    root.querySelector(".modal-message").textContent = opts.message || "";

    const inputEl = root.querySelector(".modal-input");
    const selectEl = root.querySelector(".modal-select");
    const okBtn = root.querySelector(".modal-ok");
    const cancelBtn = root.querySelector(".modal-cancel");
    const closeBtn = root.querySelector(".modal-close");

    inputEl.classList.add("hidden");
    selectEl.classList.add("hidden");
    selectEl.innerHTML = "";

    let getValue = () => (opts.input ? undefined : true);

    if (opts.input === "select") {
      selectEl.classList.remove("hidden");
      for (const opt of opts.options || []) {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        selectEl.appendChild(option);
      }
      if (opts.value) selectEl.value = opts.value;
      getValue = () => selectEl.value;
    } else if (opts.input === "text") {
      inputEl.classList.remove("hidden");
      inputEl.value = opts.value || "";
      getValue = () => inputEl.value;
    }

    okBtn.textContent = opts.okLabel || "OK";
    cancelBtn.textContent = opts.cancelLabel || "Cancel";
    cancelBtn.classList.toggle("hidden", opts.hideCancel === true);
    okBtn.className = opts.danger ? "btn btn-danger modal-ok" : "btn modal-ok";

    return new Promise((resolve) => {
      const finish = (result) => {
        root.classList.add("hidden");
        root.removeEventListener("keydown", onKey);
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        root.onclick = null;
        resolve(result);
      };

      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(opts.onCancel);
        } else if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
          e.preventDefault();
          finish(getValue());
        }
      };

      okBtn.onclick = () => finish(getValue());
      cancelBtn.onclick = () => finish(opts.onCancel);
      closeBtn.onclick = () => finish(opts.onCancel);
      root.onclick = (e) => {
        if (e.target === root) finish(opts.onCancel);
      };

      root.addEventListener("keydown", onKey);

      const focusTarget =
        opts.input === "text" ? inputEl : opts.input === "select" ? selectEl : okBtn;
      focusTarget.focus();
      if (opts.input === "text") inputEl.select();
    });
  }

  function showAlert(message, opts = {}) {
    return show({
      title: opts.title || "Notice",
      message,
      okLabel: opts.okLabel || "OK",
      hideCancel: true,
      onCancel: undefined,
    });
  }

  function showConfirm(message, opts = {}) {
    return show({
      title: opts.title || "Confirm",
      message,
      okLabel: opts.okLabel || "OK",
      cancelLabel: opts.cancelLabel || "Cancel",
      danger: opts.danger,
      onCancel: false,
    });
  }

  function showPrompt(message, value = "", opts = {}) {
    return show({
      title: opts.title || "Input",
      message,
      input: opts.input === "select" ? "select" : "text",
      options: opts.options,
      value,
      okLabel: opts.okLabel || "OK",
      cancelLabel: opts.cancelLabel || "Cancel",
      onCancel: null,
    });
  }

  return {
    alert: showAlert,
    confirm: showConfirm,
    prompt: showPrompt,
  };
})();

/*
|--------------------------------------------------------------------------
| Auth (shared)
|--------------------------------------------------------------------------
|
| Header account area, login / logout / change-password modals,
| and role helpers shared by all pages.
|
*/

const Auth = (() => {
  let currentUser = null;
  let ensured = false;

  /* ---------------------------------------------------------------- */
  /* Session                                                           */
  /* ---------------------------------------------------------------- */

  async function ensure() {
    if (ensured) {
      return currentUser;
    }

    ensured = true;

    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });

      if (res.ok) {
        const data = await res.json();
        currentUser = data.user || null;
      } else {
        currentUser = null;
      }
    } catch {
      currentUser = null;
    }

    renderAccountArea();
    return currentUser;
  }

  function getUser() {
    return currentUser;
  }

  function isLoggedIn() {
    return !!currentUser;
  }

  function hasRole(...roles) {
    return !!currentUser && roles.includes(currentUser.role);
  }

  function canMutate() {
    return hasRole("admin", "technician");
  }

  /* ---------------------------------------------------------------- */
  /* DOM helpers                                                       */
  /* ---------------------------------------------------------------- */

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function renderAccountArea() {
    const area = document.getElementById("accountArea");

    if (!area) {
      return;
    }

    // Users nav link visibility
    for (const link of document.querySelectorAll(".nav-users")) {
      link.classList.toggle("hidden", !hasRole("admin"));
    }

    if (!currentUser) {
      area.innerHTML = `<button type="button" class="btn" id="loginBtn">Login</button>`;
      const btn = document.getElementById("loginBtn");
      if (btn) btn.onclick = () => openLogin();
      return;
    }

    area.innerHTML = `
      <span class="account-info">
        <span class="account-name">${escapeHtml(currentUser.username)}</span>
        <span class="account-role role-${escapeHtml(currentUser.role)}">${escapeHtml(currentUser.role)}</span>
      </span>
      <button type="button" class="btn btn-secondary" id="accountBtn">Account</button>
      <button type="button" class="btn btn-secondary" id="logoutBtn">Logout</button>
    `;

    const accountBtn = document.getElementById("accountBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    if (accountBtn) accountBtn.onclick = () => openChangePassword();
    if (logoutBtn) logoutBtn.onclick = () => logout();
  }

  async function applyLogin(user) {
    currentUser = user;
    ensured = true;
    renderAccountArea();

    window.dispatchEvent(new CustomEvent("auth:changed", { detail: { user } }));
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* ignore */
    }

    currentUser = null;
    renderAccountArea();
    window.dispatchEvent(new CustomEvent("auth:changed", { detail: { user: null } }));
  }

  /* ---------------------------------------------------------------- */
  /* Multi-field modal (login / password)                              */
  /* ---------------------------------------------------------------- */

  function openModal({ title, fields, okLabel, onSubmit }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHtml(title)}</h2>
            <button type="button" class="btn-icon modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body auth-modal-body">
            <div class="auth-error hidden"></div>
            ${fields
              .map(
                (f) => `
              <label class="auth-field">
                <span>${escapeHtml(f.label)}</span>
                <input
                  type="${f.type || "text"}"
                  class="modal-input"
                  data-name="${escapeHtml(f.name)}"
                  placeholder="${escapeHtml(f.placeholder || "")}"
                  autocomplete="${escapeHtml(f.autocomplete || "off")}"
                >
              </label>`,
              )
              .join("")}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary modal-cancel">Cancel</button>
            <button type="button" class="btn modal-ok">${escapeHtml(okLabel || "OK")}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      const errorEl = overlay.querySelector(".auth-error");
      const inputs = [...overlay.querySelectorAll("input[data-name]")];
      const okBtn = overlay.querySelector(".modal-ok");
      const cancelBtn = overlay.querySelector(".modal-cancel");
      const closeBtn = overlay.querySelector(".modal-close");

      const getValues = () => {
        const out = {};
        for (const input of inputs) {
          out[input.dataset.name] = input.value;
        }
        return out;
      };

      const submit = async () => {
        okBtn.disabled = true;
        errorEl.classList.add("hidden");

        try {
          const result = await onSubmit(getValues());

          if (result && result.error) {
            errorEl.textContent = result.error;
            errorEl.classList.remove("hidden");
            okBtn.disabled = false;
            return;
          }

          close(result);
        } catch (error) {
          errorEl.textContent = error.message || "Request failed";
          errorEl.classList.remove("hidden");
          okBtn.disabled = false;
        }
      };

      okBtn.onclick = submit;
      cancelBtn.onclick = () => close(null);
      closeBtn.onclick = () => close(null);
      overlay.onclick = (e) => {
        if (e.target === overlay) close(null);
      };

      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        } else if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
          e.preventDefault();
          submit();
        }
      });

      (inputs[0] || okBtn).focus();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Login                                                             */
  /* ---------------------------------------------------------------- */

  function openLogin() {
    return openModal({
      title: "Login",
      okLabel: "Sign in",
      fields: [
        { name: "username", label: "Username", autocomplete: "username" },
        {
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "current-password",
        },
      ],
      onSubmit: async (values) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: values.username,
            password: values.password,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          return { error: data.error || "Login failed" };
        }

        await applyLogin(data.user);
        return { ok: true, user: data.user };
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Change password                                                   */
  /* ---------------------------------------------------------------- */

  function openChangePassword() {
    return openModal({
      title: "Change password",
      okLabel: "Save",
      fields: [
        {
          name: "currentPassword",
          label: "Current password",
          type: "password",
          autocomplete: "current-password",
        },
        {
          name: "newPassword",
          label: "New password",
          type: "password",
          autocomplete: "new-password",
        },
        {
          name: "confirmPassword",
          label: "Confirm new password",
          type: "password",
          autocomplete: "new-password",
        },
      ],
      onSubmit: async (values) => {
        if (!values.newPassword || values.newPassword.length < 3) {
          return { error: "New password must be at least 3 characters" };
        }

        if (values.newPassword !== values.confirmPassword) {
          return { error: "New passwords do not match" };
        }

        const res = await fetch("/api/auth/password", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          return { error: data.error || "Failed to change password" };
        }

        return { ok: true };
      },
    });
  }

  return {
    ensure,
    getUser,
    isLoggedIn,
    hasRole,
    canMutate,
    openLogin,
    openChangePassword,
    logout,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  Auth.ensure();
});

/*
|--------------------------------------------------------------------------
| Users page
|--------------------------------------------------------------------------
|
| Admin-only user management: list, create, edit, delete.
|
*/

const $ = (id) => document.getElementById(id);

const dom = {
  userRows: $("userRows"),
  emptyState: $("emptyState"),
  accessDenied: $("accessDenied"),
  userCount: $("userCount"),
  addUserBtn: $("addUserBtn"),
  deniedLoginBtn: $("deniedLoginBtn"),
  userModal: $("userModal"),
  userModalTitle: $("userModalTitle"),
  userModalError: $("userModalError"),
  closeUserModal: $("closeUserModal"),
  cancelUserModal: $("cancelUserModal"),
  saveUserBtn: $("saveUserBtn"),
  fieldUsername: $("fieldUsername"),
  fieldPassword: $("fieldPassword"),
  fieldRole: $("fieldRole"),
  passwordLabel: $("passwordLabel"),
};

let editingId = null;
let users = [];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function formatTs(ts) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

/* ---------------------------------------------------------------- */
/* Load + render                                                     */
/* ---------------------------------------------------------------- */

async function loadUsers() {
  const me = await Auth.ensure();

  if (!me) {
    showDenied();
    return;
  }

  if (me.role !== "admin") {
    showDenied();
    return;
  }

  dom.accessDenied.classList.add("hidden");

  try {
    const res = await fetch("/api/users", { credentials: "same-origin" });

    if (res.status === 401 || res.status === 403) {
      showDenied();
      return;
    }

    const data = await res.json();
    users = data.users || [];
    render();
  } catch (error) {
    dom.emptyState.textContent = `Failed to load users: ${error.message}`;
    dom.emptyState.classList.remove("hidden");
  }
}

function showDenied() {
  dom.accessDenied.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.userRows.innerHTML = "";
  dom.userCount.textContent = "—";
  dom.addUserBtn.classList.add("hidden");
}

function render() {
  const me = Auth.getUser();

  if (!me || me.role !== "admin") {
    showDenied();
    return;
  }

  dom.addUserBtn.classList.remove("hidden");
  dom.userCount.textContent = `${users.length} user${users.length === 1 ? "" : "s"}`;

  if (!users.length) {
    dom.userRows.innerHTML = "";
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  dom.userRows.innerHTML = users
    .map((user) => {
      const isSelf = user.id === me.id;

      return `
        <tr data-id="${user.id}">
          <td class="mono">${escapeHtml(user.username)}${isSelf ? ' <span class="text-muted">(you)</span>' : ""}</td>
          <td><span class="role-badge role-${escapeHtml(user.role)}">${escapeHtml(user.role)}</span></td>
          <td class="text-muted">${formatTs(user.createdAt)}</td>
          <td class="text-muted">${formatTs(user.updatedAt)}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-secondary btn-sm edit-btn" data-id="${user.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm delete-btn" data-id="${user.id}" ${isSelf ? "disabled" : ""}>Delete</button>
          </td>
        </tr>`;
    })
    .join("");

  for (const btn of dom.userRows.querySelectorAll(".edit-btn")) {
    btn.onclick = () => openEdit(Number(btn.dataset.id));
  }

  for (const btn of dom.userRows.querySelectorAll(".delete-btn")) {
    btn.onclick = () => deleteUser(Number(btn.dataset.id));
  }
}

/* ---------------------------------------------------------------- */
/* Modal                                                             */
/* ---------------------------------------------------------------- */

function openCreate() {
  editingId = null;
  dom.userModalTitle.textContent = "Add user";
  dom.passwordLabel.textContent = "Password";
  dom.fieldPassword.placeholder = "password";
  dom.fieldUsername.value = "";
  dom.fieldPassword.value = "";
  dom.fieldRole.value = "viewer";
  dom.userModalError.classList.add("hidden");
  dom.userModal.classList.remove("hidden");
  dom.fieldUsername.focus();
}

function openEdit(id) {
  const user = users.find((u) => u.id === id);

  if (!user) {
    return;
  }

  editingId = id;
  dom.userModalTitle.textContent = "Edit user";
  dom.passwordLabel.textContent = "Password (leave blank to keep)";
  dom.fieldPassword.placeholder = "leave blank to keep";
  dom.fieldUsername.value = user.username;
  dom.fieldPassword.value = "";
  dom.fieldRole.value = user.role;
  dom.userModalError.classList.add("hidden");
  dom.userModal.classList.remove("hidden");
  dom.fieldUsername.focus();
}

function closeModal() {
  dom.userModal.classList.add("hidden");
  editingId = null;
}

function showModalError(message) {
  dom.userModalError.textContent = message;
  dom.userModalError.classList.remove("hidden");
}

async function saveUser() {
  const username = dom.fieldUsername.value.trim();
  const password = dom.fieldPassword.value;
  const role = dom.fieldRole.value;

  if (!username) {
    showModalError("Username is required");
    return;
  }

  if (!editingId && !password) {
    showModalError("Password is required");
    return;
  }

  const payload = { username, role };

  if (password) {
    payload.password = password;
  }

  dom.saveUserBtn.disabled = true;
  dom.userModalError.classList.add("hidden");

  try {
    const res = await fetch(editingId ? `/api/users/${editingId}` : "/api/users", {
      method: editingId ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showModalError(data.error || "Save failed");
      return;
    }

    closeModal();
    await loadUsers();
  } catch (error) {
    showModalError(error.message || "Save failed");
  } finally {
    dom.saveUserBtn.disabled = false;
  }
}

async function deleteUser(id) {
  const user = users.find((u) => u.id === id);

  if (!user) {
    return;
  }

  const ok = await Modal.confirm(`Delete user "${user.username}"?`, {
    title: "Delete user",
    danger: true,
  });

  if (!ok) {
    return;
  }

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await Modal.alert(data.error || "Delete failed");
      return;
    }

    await loadUsers();
  } catch (error) {
    await Modal.alert(error.message || "Delete failed");
  }
}

/* ---------------------------------------------------------------- */
/* Wire up                                                           */
/* ---------------------------------------------------------------- */

dom.addUserBtn.onclick = openCreate;
dom.closeUserModal.onclick = closeModal;
dom.cancelUserModal.onclick = closeModal;
dom.saveUserBtn.onclick = saveUser;

dom.userModal.onclick = (e) => {
  if (e.target === dom.userModal) closeModal();
};

dom.userModal.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
  } else if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    saveUser();
  }
});

if (dom.deniedLoginBtn) {
  dom.deniedLoginBtn.onclick = async () => {
    await Auth.openLogin();
    loadUsers();
  };
}

window.addEventListener("auth:changed", () => {
  loadUsers();
});

loadUsers();

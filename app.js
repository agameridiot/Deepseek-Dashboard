// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://oazobowvagiywvpczmti.supabase.co";
const SUPABASE_KEY = "sb_publishable_PKC7Kum1tcX-9YISwy-3Tg_jVQEJ6Je";
const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";
const VALID_MODELS  = ["deepseek-chat", "deepseek-reasoner", "deepseek-coder", "deepseek-v4-flash", "deepseek-v4-pro"];

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── STATE ──────────────────────────────────────────────────────────────────
let roomPassword  = "";
let currentChatId = "main";
let apiKey        = localStorage.getItem("deepseek_api_key") || "";
let isSending     = false;
let chatNames     = JSON.parse(localStorage.getItem("chat_names") || '{"main":"main"}');

// ─── ELEMENTS ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const loginScreen       = $("loginScreen");
const chatScreen        = $("chatScreen");
const passwordInput     = $("passwordInput");
const enterBtn          = $("enterBtn");
const loginError        = $("loginError");
const messagesDiv       = $("messages");
const messageInput      = $("messageInput");
const sendBtn           = $("sendBtn");
const apiKeyInput       = $("apiKeyInput");
const saveApiBtn        = $("saveApiBtn");
const keyStatus         = $("keyStatus");
const modelSelect       = $("modelSelect");
const chatList          = $("chatList");
const newChatBtn        = $("newChatBtn");
const clearChatBtn      = $("clearChatBtn");
const logoutBtn         = $("logoutBtn");
const sidebar           = $("sidebar");
const sidebarToggle     = $("sidebarToggle");
const openSidebarBtn    = $("openSidebarBtn");
const currentChatLabel  = $("currentChatLabel");
const currentModelLabel = $("currentModelLabel");
const statusDot         = $("statusDot");
const modal             = $("modal");
const modalText         = $("modalText");
const modalCancel       = $("modalCancel");
const modalConfirm      = $("modalConfirm");
const emptyState        = $("emptyState");

// ─── INIT ────────────────────────────────────────────────────────────────────
apiKeyInput.value = apiKey;
updateSendBtn();

// ─── MARKED CONFIG ───────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

// ─── LOGIN ───────────────────────────────────────────────────────────────────
passwordInput.addEventListener("keydown", e => {
  if (e.key === "Enter") enterBtn.click();
});

enterBtn.onclick = async () => {
  const pw = passwordInput.value.trim();
  if (!pw) return;

  enterBtn.disabled = true;
  enterBtn.textContent = "Connecting...";
  loginError.classList.add("hidden");

  roomPassword = pw;

  // verify by trying to load (if room has no messages, just proceed)
  try {
    const { error } = await db
      .from("chats")
      .select("id", { count: "exact", head: true })
      .eq("room_password", pw)
      .limit(1);

    if (error) throw error;

    loginScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    renderChatList();
    await loadMessages();
  } catch (err) {
    loginError.classList.remove("hidden");
    roomPassword = "";
  } finally {
    enterBtn.disabled = false;
    enterBtn.innerHTML = 'Enter <span class="btn-arrow">→</span>';
  }
};

// ─── API KEY ─────────────────────────────────────────────────────────────────
saveApiBtn.onclick = () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showKeyStatus("No key entered", false);
    return;
  }
  apiKey = key;
  localStorage.setItem("deepseek_api_key", key);
  showKeyStatus("Saved ✓", true);
  updateSendBtn();
};

function showKeyStatus(msg, ok) {
  keyStatus.textContent = msg;
  keyStatus.className = "key-status " + (ok ? "ok" : "err");
  setTimeout(() => { keyStatus.textContent = ""; keyStatus.className = "key-status"; }, 3000);
}

// ─── MODEL ───────────────────────────────────────────────────────────────────
modelSelect.onchange = () => {
  currentModelLabel.textContent = modelSelect.value;
};

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
sidebarToggle.onclick  = () => sidebar.classList.toggle("collapsed");
openSidebarBtn.onclick = () => sidebar.classList.remove("collapsed");

// ─── CHAT LIST ───────────────────────────────────────────────────────────────
function renderChatList() {
  chatList.innerHTML = "";
  const names = Object.keys(chatNames);

  names.forEach(id => {
    const item = document.createElement("div");
    item.className = "chat-item" + (id === currentChatId ? " active" : "");
    item.dataset.id = id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-item-name";
    nameSpan.textContent = chatNames[id] || id;

    const delBtn = document.createElement("button");
    delBtn.className = "chat-item-del";
    delBtn.textContent = "✕";
    delBtn.title = "Delete chat";
    delBtn.onclick = e => {
      e.stopPropagation();
      confirmModal(`Delete chat "${chatNames[id] || id}"? This cannot be undone.`, async () => {
        await deleteChatMessages(id);
        delete chatNames[id];
        saveChatNames();
        if (currentChatId === id) {
          currentChatId = "main";
          if (!chatNames["main"]) chatNames["main"] = "main";
          saveChatNames();
        }
        renderChatList();
        await loadMessages();
      });
    };

    item.appendChild(nameSpan);
    if (id !== "main") item.appendChild(delBtn);

    item.onclick = async () => {
      if (currentChatId === id) return;
      currentChatId = id;
      currentChatLabel.textContent = chatNames[id] || id;
      renderChatList();
      await loadMessages();
    };

    chatList.appendChild(item);
  });
}

newChatBtn.onclick = () => {
  const name = prompt("Chat name (e.g. project-x):")?.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  chatNames[id] = name;
  saveChatNames();
  currentChatId = id;
  currentChatLabel.textContent = name;
  renderChatList();
  loadMessages();
};

function saveChatNames() {
  localStorage.setItem("chat_names", JSON.stringify(chatNames));
}

async function deleteChatMessages(chatId) {
  await db
    .from("chats")
    .delete()
    .eq("room_password", roomPassword)
    .eq("chat_id", chatId);
}

// ─── CLEAR CHAT ──────────────────────────────────────────────────────────────
clearChatBtn.onclick = () => {
  confirmModal(`Clear all messages in "${currentChatLabel.textContent}"?`, async () => {
    await deleteChatMessages(currentChatId);
    await loadMessages();
  });
};

// ─── LOGOUT ──────────────────────────────────────────────────────────────────
logoutBtn.onclick = () => {
  roomPassword = "";
  chatScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  passwordInput.value = "";
  messagesDiv.innerHTML = "";
  emptyState.classList.remove("hidden");
};

// ─── LOAD MESSAGES ────────────────────────────────────────────────────────────
async function loadMessages() {
  messagesDiv.innerHTML = "";
  setStatus("loading");

  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });

  setStatus("ok");

  if (error) {
    setStatus("err");
    renderError("Failed to load messages.");
    return;
  }

  if (data.length === 0) {
    messagesDiv.appendChild(emptyState);
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  data.forEach(msg => renderMessage(msg.role, msg.content, msg.model));
  scrollToBottom();
}

// ─── RENDER MESSAGE ───────────────────────────────────────────────────────────
function renderMessage(role, content, model) {
  emptyState.classList.add("hidden");

  const div = document.createElement("div");
  div.className = `message ${role}`;

  const meta = document.createElement("div");
  meta.className = "msg-meta";

  const roleTag = document.createElement("span");
  roleTag.className = "role-tag";
  roleTag.textContent = role === "user" ? "You" : "Assistant";

  const modelTag = document.createElement("span");
  modelTag.textContent = model || "";

  meta.appendChild(roleTag);
  if (model) meta.appendChild(modelTag);

  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";

  if (role === "user") {
    contentDiv.textContent = content;
    contentDiv.style.whiteSpace = "pre-wrap";
  } else {
    contentDiv.innerHTML = renderMarkdown(content);
    // syntax highlight + copy buttons
    contentDiv.querySelectorAll("pre code").forEach(block => {
      // detect lang
      const lang = block.className.replace("language-", "").trim() || "code";
      const pre   = block.parentElement;

      const header = document.createElement("div");
      header.className = "code-header";

      const langSpan = document.createElement("span");
      langSpan.textContent = lang;

      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(block.textContent).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => copyBtn.textContent = "Copy", 2000);
        });
      };

      header.appendChild(langSpan);
      header.appendChild(copyBtn);
      pre.insertBefore(header, block);

      hljs.highlightElement(block);
    });
  }

  div.appendChild(meta);
  div.appendChild(contentDiv);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return div;
}

function renderMarkdown(text) {
  return marked.parse(text || "");
}

function renderError(msg) {
  const div = document.createElement("div");
  div.className = "message error";
  div.textContent = "⚠ " + msg;
  messagesDiv.appendChild(div);
  scrollToBottom();
}

function renderThinking() {
  const div = document.createElement("div");
  div.className = "message assistant";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const roleTag = document.createElement("span");
  roleTag.className = "role-tag";
  roleTag.textContent = "Assistant";
  meta.appendChild(roleTag);

  const dots = document.createElement("div");
  dots.className = "thinking-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  div.appendChild(meta);
  div.appendChild(dots);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return div;
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendBtn.click();
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
  updateSendBtn();
});

apiKeyInput.addEventListener("input", updateSendBtn);

function updateSendBtn() {
  const hasKey = apiKey.trim().length > 0 || apiKeyInput.value.trim().length > 0;
  const hasMsg = messageInput.value.trim().length > 0;
  sendBtn.disabled = !hasKey || !hasMsg || isSending;
}

sendBtn.onclick = async () => {
  const message = messageInput.value.trim();
  if (!message || isSending) return;

  const key = apiKeyInput.value.trim() || apiKey;
  if (!key) {
    showKeyStatus("API key required", false);
    return;
  }

  apiKey = key;

  const model = modelSelect.value;
  isSending = true;
  updateSendBtn();
  setStatus("loading");

  renderMessage("user", message, model);
  await saveMessage("user", message, model);
  messageInput.value = "";
  messageInput.style.height = "auto";
  updateSendBtn();

  const thinkingDiv = renderThinking();
  const history = await getChatHistory();

  try {
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages: history })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    thinkingDiv.remove();

    const reply = data.choices?.[0]?.message?.content || "(empty response)";
    renderMessage("assistant", reply, model);
    await saveMessage("assistant", reply, model);
    setStatus("ok");

  } catch (err) {
    thinkingDiv.remove();
    renderError(err.message || "Request failed.");
    setStatus("err");
    setTimeout(() => setStatus("ok"), 4000);
  } finally {
    isSending = false;
    updateSendBtn();
  }
};

// ─── SAVE MESSAGE ─────────────────────────────────────────────────────────────
async function saveMessage(role, content, model) {
  const { error } = await db.from("chats").insert({
    room_password: roomPassword,
    chat_id: currentChatId,
    role,
    content,
    model
  });
  if (error) console.error("Save error:", error);
}

// ─── GET HISTORY ──────────────────────────────────────────────────────────────
async function getChatHistory() {
  const { data } = await db
    .from("chats")
    .select("role, content")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });

  return (data || []).map(m => ({ role: m.role, content: m.content }));
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function setStatus(state) {
  statusDot.className = "status-dot " + (state === "ok" ? "" : state);
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
let modalCallback = null;

function confirmModal(text, onConfirm) {
  modalText.textContent = text;
  modalCallback = onConfirm;
  modal.classList.remove("hidden");
}

modalCancel.onclick  = () => { modal.classList.add("hidden"); modalCallback = null; };
modalConfirm.onclick = async () => {
  modal.classList.add("hidden");
  if (modalCallback) await modalCallback();
  modalCallback = null;
};

modal.onclick = e => {
  if (e.target === modal) { modal.classList.add("hidden"); modalCallback = null; }
};

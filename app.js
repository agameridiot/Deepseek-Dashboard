// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://oazobowvagiywvpczmti.supabase.co";
const SUPABASE_KEY = "sb_publishable_PKC7Kum1tcX-9YISwy-3Tg_jVQEJ6Je";
const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── STATE ───────────────────────────────────────────────────────────────────
let roomPassword         = "";
let currentChatId        = "main";
let apiKey               = localStorage.getItem("deepseek_api_key") || "";
let isSending            = false;
let abortController      = null;
let chatNames            = JSON.parse(localStorage.getItem("chat_names") || '{"main":"main"}');
let activeSystemPromptId = localStorage.getItem("active_system_prompt") || null;
let activeFlags          = JSON.parse(localStorage.getItem("active_flags") || "[]");
let attachedFiles        = [];
let editingPromptId      = null;
let customPromptsCache   = [];
let sessionTokensIn      = 0;
let sessionTokensOut     = 0;
let chatTokensIn         = 0;
let chatTokensOut        = 0;
let editMsgCallback      = null;

// ─── BUILT-IN PROMPTS ────────────────────────────────────────────────────────
const BUILTIN_PROMPTS = [
  {
    id: "bp-file-artifacts",
    name: "File & Artifact Mode",
    category: "code",
    icon: "📦",
    builtin: true,
    text: `You are a coding assistant that produces files and artifacts. When producing code or file content, always wrap it in XML artifact tags:

<artifact filename="example.js" language="javascript">
// code here
</artifact>

Rules:
- Use <artifact filename="NAME.EXT" language="LANG"> for any complete file you produce.
- For multi-file projects, emit multiple <artifact> blocks in sequence.
- Always specify a meaningful filename and the correct language identifier.
- Outside artifact blocks, explain what each file does concisely.
- When asked to edit a file, re-emit the full updated artifact block.
- Supported languages: javascript, typescript, python, html, css, json, bash, sql, markdown, yaml, and others.`
  },
  {
    id: "bp-concise",
    name: "Short & Concise",
    category: "style",
    icon: "⚡",
    builtin: true,
    text: `Be extremely concise and direct. No preamble, no filler, no "Great question!" openers. Answer in the fewest words possible without losing accuracy. Prefer bullet points over paragraphs. Skip obvious context. If code is needed, show only the relevant snippet.`
  },
  {
    id: "bp-detailed",
    name: "Long & Explanatory",
    category: "style",
    icon: "📖",
    builtin: true,
    text: `Give thorough, educational responses. Explain your reasoning step by step. Include relevant background context, edge cases, and trade-offs. Use examples and analogies. Structure responses with headers and sections when the topic is complex. Don't skip steps — assume the user wants to fully understand.`
  },
  {
    id: "bp-senior-dev",
    name: "Senior Engineer",
    category: "persona",
    icon: "🧠",
    builtin: true,
    text: `You are a senior software engineer with 15+ years of experience across systems design, backend, and frontend. You are opinionated, pragmatic, and direct. You favour clean, maintainable code over cleverness. You point out potential bugs, performance issues, and architectural problems proactively. You don't pad responses.`
  },
  {
    id: "bp-rubber-duck",
    name: "Rubber Duck",
    category: "persona",
    icon: "🦆",
    builtin: true,
    text: `You are a rubber duck debugger. Ask clarifying questions that help the user think through their problem themselves. Don't give the answer directly — ask "What does X do?", "What did you expect to happen?", "Have you checked Y?". Guide through Socratic questioning. Only reveal the answer if the user is completely stuck.`
  },
  {
    id: "bp-code-review",
    name: "Code Reviewer",
    category: "code",
    icon: "🔍",
    builtin: true,
    text: `You are doing a thorough code review. For any code shown, analyse: correctness, edge cases, performance, security vulnerabilities, readability, naming, and conventions. Structure your review as: ISSUES (blocking), SUGGESTIONS (non-blocking), NITS (minor style). Be specific — quote the problematic line and explain exactly why.`
  },
  {
    id: "bp-architect",
    name: "System Architect",
    category: "code",
    icon: "🏗️",
    builtin: true,
    text: `You are a system architect. Focus on high-level design: data models, service boundaries, API contracts, scalability, fault tolerance, and trade-offs between approaches. Draw ASCII diagrams when helpful. Consider operational concerns: deployment, observability, and maintenance.`
  },
  {
    id: "bp-friendly",
    name: "Friendly & Casual",
    category: "persona",
    icon: "😊",
    builtin: true,
    text: `Be warm, casual, and friendly. Use conversational language. Light humour is fine. Don't be stiff or formal. Think of yourself as a knowledgeable friend — not a support bot. Still be accurate, but make it feel like a chat.`
  },
  {
    id: "bp-memory",
    name: "Memory Block",
    category: "memory",
    icon: "🧩",
    builtin: true,
    text: `[MEMORY BLOCK]
The following is persistent context about this project or user. Treat this as established facts you already know:

(Edit this prompt to add your own notes, project context, tech stack, preferences, etc.)

Example entries:
- Project: Node.js REST API using Express + PostgreSQL
- Coding style: 2-space indent, single quotes, no semicolons
- User prefers concise answers with code examples
- Don't suggest React — the project uses vanilla JS`
  },
  {
    id: "bp-nofluff",
    name: "No Fluff Mode",
    category: "style",
    icon: "🎯",
    builtin: true,
    text: `Never start responses with affirmations ("Sure!", "Absolutely!", "Great question!"). Never end with "Let me know if you need anything else!" Never explain what you're about to do — just do it. No filler. No padding. Go.`
  },
  {
    id: "bp-tutor",
    name: "Patient Tutor",
    category: "persona",
    icon: "🎓",
    builtin: true,
    text: `You are a patient, encouraging teacher. Assume the user is learning. Build explanations from first principles. Check understanding with gentle questions. When the user is wrong, correct kindly and explain why. Never make the user feel stupid.`
  },
  {
    id: "bp-security",
    name: "Security Auditor",
    category: "code",
    icon: "🔒",
    builtin: true,
    text: `You are a security-focused code reviewer. Identify: injection vulnerabilities, auth/auth flaws, insecure defaults, data exposure, dependency risks, and OWASP Top 10 issues. Classify each finding by severity (Critical / High / Medium / Low). Provide concrete remediation for each issue.`
  }
];

// ─── FLAGS ───────────────────────────────────────────────────────────────────
const BUILTIN_FLAGS = [
  { id: "flag-artifacts", name: "Artifact output",  desc: "Wrap files in <artifact> blocks",    inject: `Always wrap file/code output in <artifact filename="name.ext" language="lang">...</artifact> blocks.` },
  { id: "flag-concise",   name: "Force concise",    desc: "No preamble or filler",               inject: `Be concise. No preamble, no filler phrases, no sign-off.` },
  { id: "flag-markdown",  name: "Rich markdown",    desc: "Use headers, tables, bullets",         inject: `Format responses with rich markdown: headers, bullet lists, tables, and code blocks where appropriate.` },
  { id: "flag-stepbystep",name: "Step by step",     desc: "Always number your steps",             inject: `Structure all procedural responses as numbered steps.` },
  { id: "flag-noemoji",   name: "No emoji",         desc: "Plain text only",                      inject: `Do not use emoji anywhere in your responses.` },
  { id: "flag-json",      name: "JSON output",      desc: "Respond only in JSON",                 inject: `Respond ONLY with valid JSON. No prose, no markdown fences. Raw JSON only.` }
];

// ─── ELEMENTS ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loginScreen         = $("loginScreen");
const chatScreen          = $("chatScreen");
const passwordInput       = $("passwordInput");
const enterBtn            = $("enterBtn");
const loginError          = $("loginError");
const messagesDiv         = $("messages");
const messageInput        = $("messageInput");
const sendBtn             = $("sendBtn");
const stopBtn             = $("stopBtn");
const apiKeyInput         = $("apiKeyInput");
const saveApiBtn          = $("saveApiBtn");
const keyStatus           = $("keyStatus");
const modelSelect         = $("modelSelect");
const chatList            = $("chatList");
const newChatBtn          = $("newChatBtn");
const clearChatBtn        = $("clearChatBtn");
const exportChatBtn       = $("exportChatBtn");
const logoutBtn           = $("logoutBtn");
const sidebar             = $("sidebar");
const sidebarToggle       = $("sidebarToggle");
const openSidebarBtn      = $("openSidebarBtn");
const currentChatLabel    = $("currentChatLabel");
const currentModelLabel   = $("currentModelLabel");
const statusDot           = $("statusDot");
const streamTokenCounter  = $("streamTokenCounter");
const modal               = $("modal");
const modalText           = $("modalText");
const modalCancel         = $("modalCancel");
const modalConfirm        = $("modalConfirm");
const emptyState          = $("emptyState");
const activePromptDisplay = $("activePromptDisplay");
const clearSystemPromptBtn= $("clearSystemPromptBtn");
const promptList          = $("promptList");
const addPromptBtn        = $("addPromptBtn");
const activePromptBadge   = $("activePromptBadge");
const activePromptsBar    = $("activePromptsBar");
const attachedFilesList   = $("attachedFilesList");
const fileUploadInput     = $("fileUploadInput");
const flagsList           = $("flagsList");
const promptEditorModal   = $("promptEditorModal");
const promptEditorTitle   = $("promptEditorTitle");
const peNameInput         = $("peNameInput");
const peCatSelect         = $("peCatSelect");
const peTextarea          = $("peTextarea");
const peIconInput         = $("peIconInput");
const peCancel            = $("peCancel");
const peSave              = $("peSave");
const editMsgModal        = $("editMsgModal");
const editMsgTextarea     = $("editMsgTextarea");
const editMsgCancel       = $("editMsgCancel");
const editMsgSave         = $("editMsgSave");
const scrollBottomBtn     = $("scrollBottomBtn");
const searchToggleBtn     = $("searchToggleBtn");
const chatSearchWrap      = $("chatSearchWrap");
const chatSearchInput     = $("chatSearchInput");
const searchResults       = $("searchResults");
const promptSearchInput   = $("promptSearchInput");
const promptSyncStatus    = $("promptSyncStatus");
const tempSlider          = $("tempSlider");
const tempVal             = $("tempVal");
const maxTokensSlider     = $("maxTokensSlider");
const maxTokensVal        = $("maxTokensVal");
const tokensInVal         = $("tokensInVal");
const tokensOutVal        = $("tokensOutVal");
const tokensTotalVal      = $("tokensTotalVal");

// ─── INIT ────────────────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });
apiKeyInput.value = apiKey;
updateSendBtn();
renderFlagsList();
initSliders();
initScrollWatcher();
initKeyboardShortcuts();

// ─── SLIDERS ─────────────────────────────────────────────────────────────────
function initSliders() {
  tempSlider.addEventListener("input", () => { tempVal.textContent = parseFloat(tempSlider.value).toFixed(2); });
  maxTokensSlider.addEventListener("input", () => { maxTokensVal.textContent = maxTokensSlider.value; });
}

// ─── SCROLL WATCHER ──────────────────────────────────────────────────────────
function initScrollWatcher() {
  messagesDiv.addEventListener("scroll", () => {
    const nearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 120;
    scrollBottomBtn.classList.toggle("hidden", nearBottom);
  });
  scrollBottomBtn.onclick = scrollToBottom;
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "k") { e.preventDefault(); messageInput.focus(); }
    if (ctrl && e.key === "/") { e.preventDefault(); sidebar.classList.toggle("collapsed"); }
    if (ctrl && e.key === "l") { e.preventDefault(); clearChatBtn.click(); }
    if (ctrl && e.key === "e") { e.preventDefault(); exportChatBtn.click(); }
    if (e.altKey && e.key === "ArrowUp")   { e.preventDefault(); switchChat(-1); }
    if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); switchChat(1); }
  });
}

function switchChat(dir) {
  const ids = Object.keys(chatNames);
  const idx = ids.indexOf(currentChatId);
  const next = ids[idx + dir];
  if (next) {
    currentChatId = next;
    currentChatLabel.textContent = chatNames[next];
    renderChatList();
    loadMessages();
  }
}

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".stab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".stab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".sidebar-tab-content").forEach(t => t.classList.add("hidden"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.remove("hidden");
  };
});

// ─── PROMPT FILTER ───────────────────────────────────────────────────────────
let activeCat = "all";
let promptSearchQuery = "";

document.querySelectorAll(".pcat").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".pcat").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeCat = btn.dataset.cat;
    renderPromptList();
  };
});

promptSearchInput.addEventListener("input", () => {
  promptSearchQuery = promptSearchInput.value.toLowerCase();
  renderPromptList();
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────
passwordInput.addEventListener("keydown", e => { if (e.key === "Enter") enterBtn.click(); });

enterBtn.onclick = async () => {
  const pw = passwordInput.value.trim();
  if (!pw) return;
  enterBtn.disabled = true;
  enterBtn.textContent = "Connecting...";
  loginError.classList.add("hidden");
  roomPassword = pw;
  try {
    const { error } = await db.from("chats").select("id", { count: "exact", head: true }).eq("room_password", pw).limit(1);
    if (error) throw error;
    loginScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    await loadCustomPromptsFromDB();
    renderChatList();
    renderPromptList();
    updateActivePromptDisplay();
    updateActivePromptsBar();
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
  if (!key) { showKeyStatus("No key entered", false); return; }
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
modelSelect.onchange = () => { currentModelLabel.textContent = modelSelect.value; };

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
sidebarToggle.onclick  = () => sidebar.classList.toggle("collapsed");
openSidebarBtn.onclick = () => sidebar.classList.remove("collapsed");

// ─── CHAT LIST ───────────────────────────────────────────────────────────────
function renderChatList() {
  chatList.innerHTML = "";
  Object.keys(chatNames).forEach(id => {
    const item = document.createElement("div");
    item.className = "chat-item" + (id === currentChatId ? " active" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-item-name";
    nameSpan.textContent = chatNames[id] || id;

    // Double-click to rename
    nameSpan.ondblclick = e => {
      e.stopPropagation();
      const newName = prompt("Rename chat:", chatNames[id])?.trim();
      if (!newName) return;
      chatNames[id] = newName;
      saveChatNames();
      if (id === currentChatId) currentChatLabel.textContent = newName;
      renderChatList();
    };

    item.appendChild(nameSpan);

    const delBtn = document.createElement("button");
    delBtn.className = "chat-item-del";
    delBtn.textContent = "✕";
    delBtn.title = "Delete chat";
    delBtn.onclick = e => {
      e.stopPropagation();
      confirmModal(`Delete chat "${chatNames[id]}"? Cannot be undone.`, async () => {
        await deleteChatMessages(id);
        delete chatNames[id];
        saveChatNames();
        if (currentChatId === id) {
          currentChatId = "main";
          if (!chatNames["main"]) { chatNames["main"] = "main"; saveChatNames(); }
          currentChatLabel.textContent = chatNames["main"];
        }
        renderChatList();
        await loadMessages();
      });
    };
    item.appendChild(delBtn);

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

// ─── CHAT LABEL RENAME (double-click in header) ──────────────────────────────
currentChatLabel.ondblclick = () => {
  const newName = prompt("Rename chat:", chatNames[currentChatId])?.trim();
  if (!newName) return;
  chatNames[currentChatId] = newName;
  saveChatNames();
  currentChatLabel.textContent = newName;
  renderChatList();
};

newChatBtn.onclick = async () => {
  const name = prompt("Chat name:")?.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, "-") + "-" + Date.now().toString(36);
  chatNames[id] = name;
  saveChatNames();
  currentChatId = id;
  currentChatLabel.textContent = name;
  renderChatList();
  // Auto-name is manual here; auto-naming happens after first AI reply
  await loadMessages();
};

function saveChatNames() { localStorage.setItem("chat_names", JSON.stringify(chatNames)); }

async function deleteChatMessages(chatId) {
  await db.from("chats").delete().eq("room_password", roomPassword).eq("chat_id", chatId);
}

clearChatBtn.onclick = () => {
  confirmModal(`Clear all messages in "${currentChatLabel.textContent}"?`, async () => {
    await deleteChatMessages(currentChatId);
    chatTokensIn = 0; chatTokensOut = 0;
    updateTokenDisplay();
    await loadMessages();
  });
};

// ─── EXPORT CHAT ─────────────────────────────────────────────────────────────
exportChatBtn.onclick = async () => {
  const { data } = await db
    .from("chats").select("role, content, model, created_at")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });
  if (!data || data.length === 0) { alert("No messages to export."); return; }

  const chatName = chatNames[currentChatId] || currentChatId;
  const lines = [`# ${chatName}`, `Exported: ${new Date().toISOString()}`, ""];
  data.forEach(m => {
    const role = m.role === "user" ? "**You**" : `**Assistant** _(${m.model || "?"})_`;
    const ts = new Date(m.created_at).toLocaleString();
    lines.push(`### ${role} — ${ts}`);
    lines.push(m.content);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chatName.replace(/[^a-z0-9]/gi, "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

logoutBtn.onclick = () => {
  roomPassword = "";
  customPromptsCache = [];
  chatScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  passwordInput.value = "";
  messagesDiv.innerHTML = "";
  emptyState.classList.remove("hidden");
};

// ─── CHAT SEARCH ─────────────────────────────────────────────────────────────
searchToggleBtn.onclick = () => {
  chatSearchWrap.classList.toggle("hidden");
  searchResults.classList.add("hidden");
  if (!chatSearchWrap.classList.contains("hidden")) {
    chatSearchInput.focus();
  } else {
    chatSearchInput.value = "";
  }
};

chatSearchInput.addEventListener("input", async () => {
  const q = chatSearchInput.value.trim().toLowerCase();
  if (!q) { searchResults.classList.add("hidden"); return; }

  const { data } = await db
    .from("chats").select("role, content, created_at, chat_id")
    .eq("room_password", roomPassword)
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  searchResults.innerHTML = "";
  if (!data || data.length === 0) {
    searchResults.innerHTML = `<p class="apd-none" style="padding:8px">No results</p>`;
    searchResults.classList.remove("hidden");
    return;
  }

  data.forEach(row => {
    const div = document.createElement("div");
    div.className = "search-result-item";

    const meta = document.createElement("div");
    meta.className = "sr-meta";
    meta.textContent = `${chatNames[row.chat_id] || row.chat_id} · ${row.role}`;

    const snippet = document.createElement("div");
    snippet.className = "sr-snippet";
    const idx = row.content.toLowerCase().indexOf(q);
    const start = Math.max(0, idx - 40);
    const end = Math.min(row.content.length, idx + q.length + 60);
    snippet.textContent = (start > 0 ? "…" : "") + row.content.slice(start, end) + (end < row.content.length ? "…" : "");

    div.appendChild(meta);
    div.appendChild(snippet);

    div.onclick = async () => {
      if (currentChatId !== row.chat_id) {
        currentChatId = row.chat_id;
        currentChatLabel.textContent = chatNames[row.chat_id] || row.chat_id;
        renderChatList();
        await loadMessages();
      }
      searchResults.classList.add("hidden");
      chatSearchWrap.classList.add("hidden");
      chatSearchInput.value = "";
    };

    searchResults.appendChild(div);
  });

  searchResults.classList.remove("hidden");
});

// ─── LOAD MESSAGES ───────────────────────────────────────────────────────────
async function loadMessages() {
  messagesDiv.innerHTML = "";
  chatTokensIn = 0; chatTokensOut = 0;
  updateTokenDisplay();
  setStatus("loading");

  const { data, error } = await db
    .from("chats").select("*")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });

  setStatus("ok");
  if (error) { setStatus("err"); renderError("Failed to load messages."); return; }
  if (data.length === 0) {
    messagesDiv.appendChild(emptyState);
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  data.forEach(msg => renderMessage(msg.role, msg.content, msg.model, msg.created_at, msg.id));
  scrollToBottom();
}

// ─── RENDER MESSAGE ──────────────────────────────────────────────────────────
function renderMessage(role, content, model, timestamp, dbId) {
  emptyState.classList.add("hidden");
  const div = document.createElement("div");
  div.className = `message ${role}`;
  if (dbId) div.dataset.dbId = dbId;

  // Meta row
  const meta = document.createElement("div");
  meta.className = "msg-meta";

  const roleTag = document.createElement("span");
  roleTag.className = "role-tag";
  roleTag.textContent = role === "user" ? "You" : "Assistant";

  const modelTag = document.createElement("span");
  modelTag.textContent = model || "";

  const ts = document.createElement("span");
  ts.className = "msg-ts";
  ts.textContent = timestamp ? formatTimestamp(timestamp) : "";

  meta.appendChild(roleTag);
  if (model) meta.appendChild(modelTag);
  meta.appendChild(ts);

  // Message actions (copy, edit for user, regenerate for assistant)
  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyMsgBtn = document.createElement("button");
  copyMsgBtn.className = "msg-action-btn";
  copyMsgBtn.title = "Copy message";
  copyMsgBtn.textContent = "⎘";
  copyMsgBtn.onclick = () => {
    navigator.clipboard.writeText(content).then(() => {
      copyMsgBtn.textContent = "✓";
      setTimeout(() => copyMsgBtn.textContent = "⎘", 2000);
    });
  };
  actions.appendChild(copyMsgBtn);

  if (role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-action-btn";
    editBtn.title = "Edit & resend";
    editBtn.textContent = "✏";
    editBtn.onclick = () => openEditMsgModal(content, div);
    actions.appendChild(editBtn);
  }

  if (role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.title = "Regenerate";
    regenBtn.textContent = "↺";
    regenBtn.onclick = () => regenerateFrom(div);
    actions.appendChild(regenBtn);
  }

  // Content
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";

  if (role === "user") {
    contentDiv.textContent = content;
    contentDiv.style.whiteSpace = "pre-wrap";
  } else {
    const processed = parseArtifacts(content, contentDiv);
    if (!processed) {
      contentDiv.innerHTML = renderMarkdown(content);
      addCodeCopyButtons(contentDiv);
    }
  }

  div.appendChild(meta);
  div.appendChild(actions);
  div.appendChild(contentDiv);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return div;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── EDIT MESSAGE ────────────────────────────────────────────────────────────
function openEditMsgModal(content, msgDiv) {
  editMsgTextarea.value = content;
  editMsgModal.classList.remove("hidden");
  editMsgTextarea.focus();
  editMsgCallback = async (newContent) => {
    // Delete this message and everything after it from DB and DOM
    const allMsgs = Array.from(messagesDiv.querySelectorAll(".message"));
    const idx = allMsgs.indexOf(msgDiv);
    const toRemove = allMsgs.slice(idx);
    // Get DB IDs to delete
    const ids = toRemove.map(m => m.dataset.dbId).filter(Boolean);
    if (ids.length > 0) {
      await db.from("chats").delete().in("id", ids);
    }
    toRemove.forEach(m => m.remove());
    // Re-send with edited content
    await doSend(newContent);
  };
}

editMsgCancel.onclick = () => { editMsgModal.classList.add("hidden"); editMsgCallback = null; };
editMsgSave.onclick   = async () => {
  const text = editMsgTextarea.value.trim();
  if (!text || !editMsgCallback) return;
  editMsgModal.classList.add("hidden");
  await editMsgCallback(text);
  editMsgCallback = null;
};
editMsgModal.onclick = e => { if (e.target === editMsgModal) { editMsgModal.classList.add("hidden"); editMsgCallback = null; } };

// ─── REGENERATE ──────────────────────────────────────────────────────────────
async function regenerateFrom(assistantDiv) {
  // Remove this assistant bubble and re-run
  const allMsgs = Array.from(messagesDiv.querySelectorAll(".message"));
  const idx = allMsgs.indexOf(assistantDiv);
  const toRemove = allMsgs.slice(idx);
  const ids = toRemove.map(m => m.dataset.dbId).filter(Boolean);
  if (ids.length > 0) await db.from("chats").delete().in("id", ids);
  toRemove.forEach(m => m.remove());
  await streamAssistantReply();
}

// ─── ARTIFACT PARSING ────────────────────────────────────────────────────────
function parseArtifacts(content, container) {
  const re = /<artifact\s+filename="([^"]+)"\s+language="([^"]+)">([\s\S]*?)<\/artifact>/gi;
  let hasArtifact = false, lastIndex = 0, match;
  const parts = [];
  while ((match = re.exec(content)) !== null) {
    hasArtifact = true;
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) parts.push({ type: "text", content: before });
    parts.push({ type: "artifact", filename: match[1], language: match[2], code: match[3].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (!hasArtifact) return false;
  const after = content.slice(lastIndex);
  if (after.trim()) parts.push({ type: "text", content: after });
  parts.forEach(part => {
    if (part.type === "text") {
      const d = document.createElement("div");
      d.innerHTML = renderMarkdown(part.content);
      addCodeCopyButtons(d);
      container.appendChild(d);
    } else {
      container.appendChild(buildArtifactCard(part));
    }
  });
  return true;
}

function buildArtifactCard(part) {
  const card = document.createElement("div");
  card.className = "artifact-card";
  const header = document.createElement("div");
  header.className = "artifact-header";
  const icon = document.createElement("span");
  icon.className = "artifact-icon";
  icon.textContent = "📦";
  const info = document.createElement("div");
  info.className = "artifact-info";
  const fname = document.createElement("span");
  fname.className = "artifact-filename";
  fname.textContent = part.filename;
  const flang = document.createElement("span");
  flang.className = "artifact-lang";
  flang.textContent = part.language;
  info.appendChild(fname);
  info.appendChild(flang);
  const actions = document.createElement("div");
  actions.className = "artifact-actions";
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => navigator.clipboard.writeText(part.code).then(() => {
    copyBtn.textContent = "Copied!"; setTimeout(() => copyBtn.textContent = "Copy", 2000);
  });
  const dlBtn = document.createElement("button");
  dlBtn.className = "copy-btn";
  dlBtn.textContent = "↓ Download";
  dlBtn.onclick = () => {
    const blob = new Blob([part.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = part.filename; a.click();
    URL.revokeObjectURL(url);
  };
  actions.appendChild(copyBtn);
  actions.appendChild(dlBtn);
  header.appendChild(icon); header.appendChild(info); header.appendChild(actions);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${part.language}`;
  code.textContent = part.code;
  pre.appendChild(code);
  hljs.highlightElement(code);
  card.appendChild(header);
  card.appendChild(pre);
  return card;
}

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre code").forEach(block => {
    const lang = (block.className.replace("language-", "") || "code").trim();
    const pre = block.parentElement;
    const header = document.createElement("div");
    header.className = "code-header";
    const langSpan = document.createElement("span");
    langSpan.textContent = lang;
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => navigator.clipboard.writeText(block.textContent).then(() => {
      copyBtn.textContent = "Copied!"; setTimeout(() => copyBtn.textContent = "Copy", 2000);
    });
    header.appendChild(langSpan);
    header.appendChild(copyBtn);
    pre.insertBefore(header, block);
    hljs.highlightElement(block);
  });
}

function renderMarkdown(text) { return marked.parse(text || ""); }

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

function createStreamingBubble(model) {
  emptyState.classList.add("hidden");
  const div = document.createElement("div");
  div.className = "message assistant streaming";
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const roleTag = document.createElement("span");
  roleTag.className = "role-tag";
  roleTag.textContent = "Assistant";
  const modelTag = document.createElement("span");
  modelTag.textContent = model || "";
  meta.appendChild(roleTag);
  if (model) meta.appendChild(modelTag);
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content stream-content";
  const cursor = document.createElement("span");
  cursor.className = "stream-cursor";
  contentDiv.appendChild(cursor);
  div.appendChild(meta);
  div.appendChild(contentDiv);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return { div, contentDiv, cursor };
}

function finaliseStreamingBubble(contentDiv, cursor, rawText) {
  cursor.remove();
  contentDiv.innerHTML = "";
  const processed = parseArtifacts(rawText, contentDiv);
  if (!processed) {
    contentDiv.innerHTML = renderMarkdown(rawText);
    addCodeCopyButtons(contentDiv);
  }
}

// ─── SEND MESSAGE ────────────────────────────────────────────────────────────
messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendBtn.click(); }
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
  stopBtn.classList.toggle("hidden", !isSending);
  sendBtn.classList.toggle("hidden", isSending);
}

stopBtn.onclick = () => {
  if (abortController) abortController.abort();
};

sendBtn.onclick = async () => {
  const message = messageInput.value.trim();
  if (!message || isSending) return;
  const key = apiKeyInput.value.trim() || apiKey;
  if (!key) { showKeyStatus("API key required", false); return; }
  apiKey = key;
  messageInput.value = "";
  messageInput.style.height = "auto";
  renderMessage("user", message, null, new Date().toISOString());
  await saveMessage("user", message, modelSelect.value);
  await doSend(message);
};

async function doSend(userText) {
  isSending = true;
  updateSendBtn();
  setStatus("loading");

  const model = modelSelect.value;
  const history = await getChatHistory();
  const systemPrompt = buildSystemPrompt();
  const messages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...history] : history;

  let streamBubble = null;
  let rawReply = "";
  let tokenCount = 0;
  const thinkingDiv = renderThinking();

  abortController = new AbortController();

  // Show live token counter
  streamTokenCounter.textContent = "";
  streamTokenCounter.classList.remove("hidden");

  try {
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: parseFloat(tempSlider.value),
        max_tokens: parseInt(maxTokensSlider.value)
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    thinkingDiv.remove();
    streamBubble = createStreamingBubble(model);
    const { contentDiv, cursor } = streamBubble;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            rawReply += delta;
            tokenCount += delta.split(/\s+/).length; // rough estimate
            contentDiv.insertBefore(document.createTextNode(delta), cursor);
            scrollToBottom();
            streamTokenCounter.textContent = `~${tokenCount} tokens`;
          }
          // Usage data sometimes arrives in final chunk
          if (json.usage) {
            const u = json.usage;
            chatTokensIn  += u.prompt_tokens || 0;
            chatTokensOut += u.completion_tokens || 0;
            sessionTokensIn  += u.prompt_tokens || 0;
            sessionTokensOut += u.completion_tokens || 0;
            updateTokenDisplay();
          }
        } catch (_) {}
      }
    }

    finaliseStreamingBubble(contentDiv, cursor, rawReply);
    streamBubble.div.classList.remove("streaming");
    // Re-add action buttons to the finalised bubble
    addMessageActions(streamBubble.div, rawReply, model, "assistant");
    scrollToBottom();

    const { data: saved } = await saveMessage("assistant", rawReply, model);
    setStatus("ok");

    // Auto-name chat after first exchange if name is still the default id
    const chatMsgCount = messagesDiv.querySelectorAll(".message").length;
    if (chatMsgCount <= 2) {
      autoNameChat(rawReply);
    }

  } catch (err) {
    thinkingDiv.remove();
    if (streamBubble) streamBubble.div.remove();
    if (err.name !== "AbortError") {
      renderError(err.message || "Request failed.");
      setStatus("err");
      setTimeout(() => setStatus("ok"), 4000);
    } else {
      // Aborted mid-stream — save what we have
      if (rawReply.trim()) {
        if (streamBubble) {
          finaliseStreamingBubble(streamBubble.contentDiv, streamBubble.cursor, rawReply);
          streamBubble.div.classList.remove("streaming");
        }
        await saveMessage("assistant", rawReply + "\n\n_(generation stopped)_", model);
      }
      setStatus("ok");
    }
  } finally {
    isSending = false;
    abortController = null;
    streamTokenCounter.classList.add("hidden");
    updateSendBtn();
  }
}

function addMessageActions(div, content, model, role) {
  // Only add if not already present
  if (div.querySelector(".msg-actions")) return;
  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-action-btn";
  copyBtn.title = "Copy message";
  copyBtn.textContent = "⎘";
  copyBtn.onclick = () => navigator.clipboard.writeText(content).then(() => {
    copyBtn.textContent = "✓"; setTimeout(() => copyBtn.textContent = "⎘", 2000);
  });
  actions.appendChild(copyBtn);

  if (role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.title = "Regenerate";
    regenBtn.textContent = "↺";
    regenBtn.onclick = () => regenerateFrom(div);
    actions.appendChild(regenBtn);
  }

  // Insert after meta
  const meta = div.querySelector(".msg-meta");
  meta.insertAdjacentElement("afterend", actions);
}

// ─── AUTO-NAME CHAT ───────────────────────────────────────────────────────────
async function autoNameChat(firstReply) {
  // Only auto-name if name still looks like a generated ID or "main"
  const current = chatNames[currentChatId] || currentChatId;
  if (current !== "main" && !current.match(/^.+-[a-z0-9]{4,}$/)) return;
  if (current === "main") return; // never rename main

  try {
    const res = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: `Give a short (3-5 word) chat title for this conversation based on this response. Respond with ONLY the title, no punctuation, no quotes:\n\n${firstReply.slice(0, 400)}` }
        ],
        max_tokens: 20,
        temperature: 0.3
      })
    });
    const data = await res.json();
    const name = data.choices?.[0]?.message?.content?.trim().replace(/['"]/g, "");
    if (name && name.length < 60) {
      chatNames[currentChatId] = name;
      saveChatNames();
      currentChatLabel.textContent = name;
      renderChatList();
    }
  } catch (_) {}
}

// ─── SYSTEM PROMPT BUILDER ───────────────────────────────────────────────────
function buildSystemPrompt() {
  const parts = [];
  if (activeSystemPromptId) {
    const p = getPromptById(activeSystemPromptId);
    if (p) parts.push(p.text);
  }
  activeFlags.forEach(flagId => {
    const f = BUILTIN_FLAGS.find(fl => fl.id === flagId);
    if (f) parts.push(f.inject);
  });
  attachedFiles.forEach(f => {
    parts.push(`\n--- FILE: ${f.name} ---\n${f.content}\n--- END FILE ---`);
  });
  return parts.join("\n\n").trim();
}

function getPromptById(id) {
  return BUILTIN_PROMPTS.find(p => p.id === id) || customPromptsCache.find(p => p.id === id) || null;
}

// ─── SUPABASE CUSTOM PROMPTS ─────────────────────────────────────────────────
async function loadCustomPromptsFromDB() {
  setSyncStatus("syncing");
  try {
    const { data, error } = await db
      .from("custom_prompts")
      .select("*")
      .eq("room_password", roomPassword)
      .order("created_at", { ascending: true });
    if (error) throw error;
    customPromptsCache = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      icon: r.icon,
      text: r.text,
      builtin: false
    }));
    setSyncStatus("ok");
  } catch (err) {
    console.warn("Could not load prompts from DB, falling back to localStorage:", err.message);
    // Fallback: migrate localStorage prompts
    customPromptsCache = JSON.parse(localStorage.getItem("custom_prompts") || "[]");
    setSyncStatus("err");
  }
}

async function saveCustomPromptToDB(prompt) {
  setSyncStatus("syncing");
  try {
    const { error } = await db.from("custom_prompts").upsert({
      id: prompt.id,
      room_password: roomPassword,
      name: prompt.name,
      category: prompt.category,
      icon: prompt.icon,
      text: prompt.text,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    setSyncStatus("ok");
    return true;
  } catch (err) {
    console.error("Save prompt error:", err);
    setSyncStatus("err");
    return false;
  }
}

async function deleteCustomPromptFromDB(id) {
  try {
    await db.from("custom_prompts").delete().eq("id", id).eq("room_password", roomPassword);
  } catch (err) {
    console.error("Delete prompt error:", err);
  }
}

function setSyncStatus(state) {
  if (!promptSyncStatus) return;
  const map = { syncing: "⟳ syncing", ok: "✓ synced", err: "⚠ offline" };
  promptSyncStatus.textContent = map[state] || "";
  promptSyncStatus.className = "sync-status " + state;
}

function getAllPrompts() {
  return [...BUILTIN_PROMPTS, ...customPromptsCache];
}

// ─── PROMPT LIST ──────────────────────────────────────────────────────────────
function renderPromptList() {
  promptList.innerHTML = "";
  let all = getAllPrompts();

  if (activeCat !== "all") all = all.filter(p => p.category === activeCat);
  if (promptSearchQuery) all = all.filter(p =>
    p.name.toLowerCase().includes(promptSearchQuery) ||
    p.text.toLowerCase().includes(promptSearchQuery)
  );

  if (all.length === 0) {
    promptList.innerHTML = `<p class="apd-none">No prompts found.</p>`;
    return;
  }

  all.forEach(p => {
    const item = document.createElement("div");
    item.className = "prompt-item" + (activeSystemPromptId === p.id ? " active" : "");

    const left = document.createElement("div");
    left.className = "prompt-item-left";
    const icon = document.createElement("span");
    icon.className = "prompt-item-icon";
    icon.textContent = p.icon || "📝";
    const info = document.createElement("div");
    info.className = "prompt-item-info";
    const name = document.createElement("span");
    name.className = "prompt-item-name";
    name.textContent = p.name;
    const cat = document.createElement("span");
    cat.className = "prompt-item-cat";
    cat.textContent = p.category;
    info.appendChild(name); info.appendChild(cat);
    left.appendChild(icon); left.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "prompt-item-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "pi-btn" + (activeSystemPromptId === p.id ? " active" : "");
    toggleBtn.textContent = activeSystemPromptId === p.id ? "✓ On" : "Set";
    toggleBtn.onclick = e => {
      e.stopPropagation();
      activeSystemPromptId = activeSystemPromptId === p.id ? null : p.id;
      if (activeSystemPromptId) localStorage.setItem("active_system_prompt", p.id);
      else localStorage.removeItem("active_system_prompt");
      renderPromptList();
      updateActivePromptDisplay();
      updateActivePromptsBar();
    };
    actions.appendChild(toggleBtn);

    const editBtn = document.createElement("button");
    editBtn.className = "pi-btn";
    editBtn.textContent = p.builtin ? "👁" : "✏";
    editBtn.onclick = e => { e.stopPropagation(); openPromptEditor(p.builtin ? null : p.id, p); };
    actions.appendChild(editBtn);

    if (!p.builtin) {
      const delBtn = document.createElement("button");
      delBtn.className = "pi-btn danger";
      delBtn.textContent = "✕";
      delBtn.onclick = e => {
        e.stopPropagation();
        confirmModal(`Delete prompt "${p.name}"?`, async () => {
          await deleteCustomPromptFromDB(p.id);
          customPromptsCache = customPromptsCache.filter(c => c.id !== p.id);
          if (activeSystemPromptId === p.id) {
            activeSystemPromptId = null;
            localStorage.removeItem("active_system_prompt");
            updateActivePromptDisplay();
            updateActivePromptsBar();
          }
          renderPromptList();
        });
      };
      actions.appendChild(delBtn);
    }

    item.appendChild(left);
    item.appendChild(actions);
    promptList.appendChild(item);
  });
}

// ─── ACTIVE PROMPT DISPLAY ────────────────────────────────────────────────────
function updateActivePromptDisplay() {
  if (!activeSystemPromptId) {
    activePromptDisplay.innerHTML = `<span class="apd-none">None — using model default</span>`;
    activePromptBadge.classList.add("hidden");
    return;
  }
  const p = getPromptById(activeSystemPromptId);
  if (!p) {
    activePromptDisplay.innerHTML = `<span class="apd-none">None</span>`;
    activePromptBadge.classList.add("hidden");
    return;
  }
  activePromptDisplay.innerHTML = `<span class="apd-active">${p.icon || "📝"} ${p.name}</span>`;
  activePromptBadge.textContent = `${p.icon || "📝"} ${p.name}`;
  activePromptBadge.classList.remove("hidden");
}

function updateActivePromptsBar() {
  const hasPrompt = !!activeSystemPromptId;
  const hasFlags  = activeFlags.length > 0;
  const hasFiles  = attachedFiles.length > 0;

  if (!hasPrompt && !hasFlags && !hasFiles) { activePromptsBar.classList.add("hidden"); return; }
  activePromptsBar.classList.remove("hidden");
  activePromptsBar.innerHTML = "";

  if (hasPrompt) {
    const p = getPromptById(activeSystemPromptId);
    if (p) {
      const chip = document.createElement("span");
      chip.className = "apbar-chip";
      chip.textContent = `${p.icon || "📝"} ${p.name}`;
      activePromptsBar.appendChild(chip);
    }
  }
  activeFlags.forEach(fid => {
    const f = BUILTIN_FLAGS.find(fl => fl.id === fid);
    if (f) {
      const chip = document.createElement("span");
      chip.className = "apbar-chip flag";
      chip.textContent = `⚑ ${f.name}`;
      activePromptsBar.appendChild(chip);
    }
  });
  attachedFiles.forEach(f => {
    const chip = document.createElement("span");
    chip.className = "apbar-chip file";
    chip.textContent = `📎 ${f.name}`;
    activePromptsBar.appendChild(chip);
  });
}

clearSystemPromptBtn.onclick = () => {
  activeSystemPromptId = null;
  localStorage.removeItem("active_system_prompt");
  renderPromptList();
  updateActivePromptDisplay();
  updateActivePromptsBar();
};

// ─── PROMPT EDITOR ───────────────────────────────────────────────────────────
addPromptBtn.onclick = () => openPromptEditor(null, null);

function openPromptEditor(editId, prefill) {
  editingPromptId = editId;
  const isBuiltin = prefill?.builtin;
  promptEditorTitle.textContent = isBuiltin ? "Preview Prompt" : (editId ? "Edit Prompt" : "New Prompt");
  peNameInput.value  = prefill?.name     || "";
  peCatSelect.value  = prefill?.category || "custom";
  peTextarea.value   = prefill?.text     || "";
  peIconInput.value  = prefill?.icon     || "";
  [peNameInput, peCatSelect, peTextarea, peIconInput].forEach(el => el.disabled = !!isBuiltin);
  peSave.style.display = isBuiltin ? "none" : "";
  promptEditorModal.classList.remove("hidden");
}

peCancel.onclick = () => { promptEditorModal.classList.add("hidden"); editingPromptId = null; };

peSave.onclick = async () => {
  const name = peNameInput.value.trim();
  const text = peTextarea.value.trim();
  if (!name || !text) { alert("Name and prompt text are required."); return; }

  const id = editingPromptId || ("cp-" + Date.now());
  const prompt = {
    id,
    name,
    category: peCatSelect.value,
    text,
    icon: peIconInput.value.trim() || "📝",
    builtin: false
  };

  const saved = await saveCustomPromptToDB(prompt);
  if (saved) {
    if (editingPromptId) {
      customPromptsCache = customPromptsCache.map(p => p.id === editingPromptId ? prompt : p);
    } else {
      customPromptsCache.push(prompt);
    }
  } else {
    // Fallback to localStorage
    let local = JSON.parse(localStorage.getItem("custom_prompts") || "[]");
    if (editingPromptId) local = local.map(p => p.id === editingPromptId ? prompt : p);
    else local.push(prompt);
    localStorage.setItem("custom_prompts", JSON.stringify(local));
    customPromptsCache = local;
  }

  promptEditorModal.classList.add("hidden");
  editingPromptId = null;
  renderPromptList();
};

promptEditorModal.onclick = e => {
  if (e.target === promptEditorModal) { promptEditorModal.classList.add("hidden"); editingPromptId = null; }
};

// ─── FLAGS ───────────────────────────────────────────────────────────────────
function renderFlagsList() {
  flagsList.innerHTML = "";
  BUILTIN_FLAGS.forEach(f => {
    const row = document.createElement("div");
    row.className = "flag-row";
    const left = document.createElement("div");
    left.className = "flag-left";
    const toggle = document.createElement("button");
    toggle.className = "flag-toggle" + (activeFlags.includes(f.id) ? " on" : "");
    toggle.onclick = () => {
      activeFlags = activeFlags.includes(f.id)
        ? activeFlags.filter(id => id !== f.id)
        : [...activeFlags, f.id];
      localStorage.setItem("active_flags", JSON.stringify(activeFlags));
      toggle.className = "flag-toggle" + (activeFlags.includes(f.id) ? " on" : "");
      updateActivePromptsBar();
    };
    const textWrap = document.createElement("div");
    textWrap.style.cssText = "display:flex;flex-direction:column;gap:1px";
    const nameSpan = document.createElement("span");
    nameSpan.className = "flag-name";
    nameSpan.textContent = f.name;
    const descSpan = document.createElement("span");
    descSpan.className = "flag-desc";
    descSpan.textContent = f.desc;
    left.appendChild(toggle);
    textWrap.appendChild(nameSpan);
    textWrap.appendChild(descSpan);
    row.appendChild(left);
    row.appendChild(textWrap);
    flagsList.appendChild(row);
  });
}

// ─── FILE ATTACHMENTS ────────────────────────────────────────────────────────
fileUploadInput.onchange = async (e) => {
  for (const file of Array.from(e.target.files)) {
    const text = await file.text();
    if (!attachedFiles.find(f => f.name === file.name))
      attachedFiles.push({ name: file.name, content: text });
  }
  fileUploadInput.value = "";
  renderAttachedFiles();
  updateActivePromptsBar();
};

function renderAttachedFiles() {
  attachedFilesList.innerHTML = "";
  if (attachedFiles.length === 0) {
    attachedFilesList.innerHTML = `<span class="apd-none">No files attached</span>`;
    return;
  }
  attachedFiles.forEach((f, idx) => {
    const row = document.createElement("div");
    row.className = "attached-file-row";
    const name = document.createElement("span");
    name.className = "af-name";
    name.textContent = f.name;
    const size = document.createElement("span");
    size.className = "af-size";
    size.textContent = formatBytes(f.content.length);
    const del = document.createElement("button");
    del.className = "chat-item-del";
    del.textContent = "✕";
    del.style.opacity = "1";
    del.onclick = () => { attachedFiles.splice(idx, 1); renderAttachedFiles(); updateActivePromptsBar(); };
    row.appendChild(name); row.appendChild(size); row.appendChild(del);
    attachedFilesList.appendChild(row);
  });
}

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

// ─── TOKEN DISPLAY ────────────────────────────────────────────────────────────
function updateTokenDisplay() {
  tokensInVal.textContent    = chatTokensIn    > 0 ? chatTokensIn.toLocaleString()    : "—";
  tokensOutVal.textContent   = chatTokensOut   > 0 ? chatTokensOut.toLocaleString()   : "—";
  const total = sessionTokensIn + sessionTokensOut;
  tokensTotalVal.textContent = total           > 0 ? total.toLocaleString()           : "—";
}

// ─── SAVE / GET HISTORY ──────────────────────────────────────────────────────
async function saveMessage(role, content, model) {
  const { data, error } = await db.from("chats").insert({
    room_password: roomPassword,
    chat_id: currentChatId,
    role, content, model
  }).select("id").single();
  if (error) console.error("Save error:", error);
  return { data };
}

async function getChatHistory() {
  const { data } = await db
    .from("chats").select("role, content")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });
  return (data || []).map(m => ({ role: m.role, content: m.content }));
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function scrollToBottom() { messagesDiv.scrollTop = messagesDiv.scrollHeight; }
function setStatus(s) { statusDot.className = "status-dot " + (s === "ok" ? "" : s); }

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
let modalCallback = null;
function confirmModal(text, onConfirm) {
  modalText.textContent = text;
  modalCallback = onConfirm;
  modal.classList.remove("hidden");
}
modalCancel.onclick  = () => { modal.classList.add("hidden"); modalCallback = null; };
modalConfirm.onclick = async () => { modal.classList.add("hidden"); if (modalCallback) await modalCallback(); modalCallback = null; };
modal.onclick = e => { if (e.target === modal) { modal.classList.add("hidden"); modalCallback = null; } };

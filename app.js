// ─── CONFIG ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://oazobowvagiywvpczmti.supabase.co";
const SUPABASE_KEY = "sb_publishable_PKC7Kum1tcX-9YISwy-3Tg_jVQEJ6Je";
const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── STATE ───────────────────────────────────────────────────────────────────
let roomPassword    = "";
let currentChatId   = "main";
let apiKey          = localStorage.getItem("deepseek_api_key") || "";
let isSending       = false;
let chatNames       = JSON.parse(localStorage.getItem("chat_names") || '{"main":"main"}');
let activeSystemPromptId = localStorage.getItem("active_system_prompt") || null;
let activeFlags     = JSON.parse(localStorage.getItem("active_flags") || "[]");
let attachedFiles   = []; // [{name, content}]
let editingPromptId = null;

// ─── BUILT-IN PROMPTS ────────────────────────────────────────────────────────
const BUILTIN_PROMPTS = [
  {
    id: "bp-file-artifacts",
    name: "File & Artifact Mode",
    category: "code",
    icon: "📦",
    builtin: true,
    text: `You are a coding assistant that can produce files and artifacts. When producing code or file content, always wrap it in the following XML tags so the UI can parse and render it as a downloadable artifact:

<artifact filename="example.js" language="javascript">
// code here
</artifact>

Rules:
- Use <artifact filename="NAME.EXT" language="LANG"> for any complete file you produce.
- For multi-file projects, emit multiple <artifact> blocks in sequence.
- Always specify a meaningful filename and the correct language identifier.
- Outside of artifact blocks, explain what each file does concisely.
- When the user asks you to edit a file, re-emit the full updated artifact block — never partial diffs unless specifically asked.
- Supported language values: javascript, typescript, python, html, css, json, bash, sql, markdown, yaml, and others.`
  },
  {
    id: "bp-concise",
    name: "Short & Concise",
    category: "style",
    icon: "⚡",
    builtin: true,
    text: `Be extremely concise and direct. No preamble, no filler, no "Great question!" or similar openers. Answer in the fewest words possible without losing accuracy. Prefer bullet points over paragraphs. Skip obvious context — the user already knows it. If code is needed, show only the relevant snippet.`
  },
  {
    id: "bp-detailed",
    name: "Long & Explanatory",
    category: "style",
    icon: "📖",
    builtin: true,
    text: `Give thorough, educational responses. Explain your reasoning step by step. Include relevant background context, edge cases, and trade-offs. Use examples and analogies to make concepts clear. Structure responses with headers and sections when the topic is complex. Don't skip steps — assume the user wants to fully understand, not just copy-paste.`
  },
  {
    id: "bp-senior-dev",
    name: "Senior Engineer",
    category: "persona",
    icon: "🧠",
    builtin: true,
    text: `You are a senior software engineer with 15+ years of experience across systems design, backend, and frontend. You are opinionated, pragmatic, and direct. You favour clean, maintainable code over cleverness. You point out potential bugs, performance issues, and architectural problems proactively. You know when to follow best practices and when to pragmatically break them. You don't pad responses — say what needs to be said.`
  },
  {
    id: "bp-rubber-duck",
    name: "Rubber Duck",
    category: "persona",
    icon: "🦆",
    builtin: true,
    text: `You are a rubber duck debugger. Your job is to ask clarifying questions that help the user think through their problem themselves. Don't give the answer directly — ask "What does X do?", "What did you expect to happen?", "Have you checked Y?". Guide through Socratic questioning. Only reveal the answer if the user is completely stuck after several exchanges.`
  },
  {
    id: "bp-code-review",
    name: "Code Reviewer",
    category: "code",
    icon: "🔍",
    builtin: true,
    text: `You are doing a thorough code review. For any code shown, analyse: correctness, edge cases, performance, security vulnerabilities, readability, naming, and adherence to common conventions. Structure your review as: ISSUES (blocking), SUGGESTIONS (non-blocking), NITS (minor style). Be specific — quote the problematic line and explain exactly why it's an issue and how to fix it.`
  },
  {
    id: "bp-architect",
    name: "System Architect",
    category: "code",
    icon: "🏗️",
    builtin: true,
    text: `You are a system architect. Focus on high-level design: data models, service boundaries, API contracts, scalability, fault tolerance, and trade-offs between approaches. When discussing implementation details, keep them in service of the architecture. Draw ASCII diagrams when helpful. Consider operational concerns: deployment, observability, and maintenance.`
  },
  {
    id: "bp-friendly",
    name: "Friendly & Casual",
    category: "persona",
    icon: "😊",
    builtin: true,
    text: `Be warm, casual, and friendly. Use conversational language. It's fine to use light humour where appropriate. Don't be stiff or overly formal. Think of yourself as a knowledgeable friend helping out — not a customer service bot. Still be accurate and helpful, but make it feel like a chat, not a support ticket.`
  },
  {
    id: "bp-memory",
    name: "Memory Block",
    category: "memory",
    icon: "🧩",
    builtin: true,
    text: `[MEMORY BLOCK]
The following is persistent context about this project or user. Treat this as established facts you already know — do not ask the user to re-explain these things:

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
    text: `Never start responses with affirmations ("Sure!", "Absolutely!", "Great question!"). Never end with offers to help more ("Let me know if you need anything else!"). Never explain what you're about to do — just do it. No filler words. No padding. Go.`
  },
  {
    id: "bp-tutor",
    name: "Patient Tutor",
    category: "persona",
    icon: "🎓",
    builtin: true,
    text: `You are a patient, encouraging teacher. Assume the user is learning and may not know terminology. Build up explanations from first principles. Check understanding with gentle questions. When the user is wrong, correct kindly and explain why. Celebrate progress. Never make the user feel stupid for not knowing something.`
  },
  {
    id: "bp-security",
    name: "Security Auditor",
    category: "code",
    icon: "🔒",
    builtin: true,
    text: `You are a security-focused code reviewer. For any code, infrastructure config, or system design shown, identify: injection vulnerabilities, auth/auth flaws, insecure defaults, data exposure, dependency risks, and OWASP Top 10 issues. Classify each finding by severity (Critical / High / Medium / Low). Provide a concrete remediation for each issue. If no issues are found, explain why the code is secure.`
  }
];

// ─── FLAGS ───────────────────────────────────────────────────────────────────
const BUILTIN_FLAGS = [
  {
    id: "flag-artifacts",
    name: "Artifact output",
    desc: "Wrap files in <artifact> blocks",
    inject: `Always wrap file/code output in <artifact filename="name.ext" language="lang">...</artifact> blocks.`
  },
  {
    id: "flag-concise",
    name: "Force concise",
    desc: "No preamble or filler",
    inject: `Be concise. No preamble, no filler phrases, no sign-off.`
  },
  {
    id: "flag-markdown",
    name: "Rich markdown",
    desc: "Use headers, tables, bullets",
    inject: `Format responses with rich markdown: use headers, bullet lists, tables, and code blocks where appropriate.`
  },
  {
    id: "flag-stepbystep",
    name: "Step by step",
    desc: "Always number your steps",
    inject: `Structure all procedural responses as numbered steps.`
  },
  {
    id: "flag-noemoji",
    name: "No emoji",
    desc: "Plain text only",
    inject: `Do not use emoji anywhere in your responses.`
  },
  {
    id: "flag-json",
    name: "JSON output",
    desc: "Respond only in JSON",
    inject: `Respond ONLY with valid JSON. No prose, no markdown fences. Raw JSON only.`
  }
];

// ─── ELEMENTS ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loginScreen        = $("loginScreen");
const chatScreen         = $("chatScreen");
const passwordInput      = $("passwordInput");
const enterBtn           = $("enterBtn");
const loginError         = $("loginError");
const messagesDiv        = $("messages");
const messageInput       = $("messageInput");
const sendBtn            = $("sendBtn");
const apiKeyInput        = $("apiKeyInput");
const saveApiBtn         = $("saveApiBtn");
const keyStatus          = $("keyStatus");
const modelSelect        = $("modelSelect");
const chatList           = $("chatList");
const newChatBtn         = $("newChatBtn");
const clearChatBtn       = $("clearChatBtn");
const logoutBtn          = $("logoutBtn");
const sidebar            = $("sidebar");
const sidebarToggle      = $("sidebarToggle");
const openSidebarBtn     = $("openSidebarBtn");
const currentChatLabel   = $("currentChatLabel");
const currentModelLabel  = $("currentModelLabel");
const statusDot          = $("statusDot");
const modal              = $("modal");
const modalText          = $("modalText");
const modalCancel        = $("modalCancel");
const modalConfirm       = $("modalConfirm");
const emptyState         = $("emptyState");
const activePromptDisplay= $("activePromptDisplay");
const clearSystemPromptBtn=$("clearSystemPromptBtn");
const promptList         = $("promptList");
const addPromptBtn       = $("addPromptBtn");
const activePromptBadge  = $("activePromptBadge");
const activePromptsBar   = $("activePromptsBar");
const attachedFilesList  = $("attachedFilesList");
const fileUploadInput    = $("fileUploadInput");
const flagsList          = $("flagsList");
const promptEditorModal  = $("promptEditorModal");
const promptEditorTitle  = $("promptEditorTitle");
const peNameInput        = $("peNameInput");
const peCatSelect        = $("peCatSelect");
const peTextarea         = $("peTextarea");
const peIconInput        = $("peIconInput");
const peCancel           = $("peCancel");
const peSave             = $("peSave");

// ─── INIT ────────────────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });
apiKeyInput.value = apiKey;
updateSendBtn();
renderFlagsList();

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".stab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".stab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".sidebar-tab-content").forEach(t => t.classList.add("hidden"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.remove("hidden");
  };
});

// ─── PROMPT CATEGORY FILTER ──────────────────────────────────────────────────
let activeCat = "all";
document.querySelectorAll(".pcat").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".pcat").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeCat = btn.dataset.cat;
    renderPromptList();
  };
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

    item.appendChild(nameSpan);

    if (id !== "main") {
      const delBtn = document.createElement("button");
      delBtn.className = "chat-item-del";
      delBtn.textContent = "✕";
      delBtn.onclick = e => {
        e.stopPropagation();
        confirmModal(`Delete chat "${chatNames[id]}"? Cannot be undone.`, async () => {
          await deleteChatMessages(id);
          delete chatNames[id];
          saveChatNames();
          if (currentChatId === id) {
            currentChatId = "main";
            if (!chatNames["main"]) chatNames["main"] = "main";
            saveChatNames();
            currentChatLabel.textContent = "main";
          }
          renderChatList();
          await loadMessages();
        });
      };
      item.appendChild(delBtn);
    }

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
  const name = prompt("Chat name:")?.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  chatNames[id] = name;
  saveChatNames();
  currentChatId = id;
  currentChatLabel.textContent = name;
  renderChatList();
  loadMessages();
};

function saveChatNames() { localStorage.setItem("chat_names", JSON.stringify(chatNames)); }

async function deleteChatMessages(chatId) {
  await db.from("chats").delete().eq("room_password", roomPassword).eq("chat_id", chatId);
}

clearChatBtn.onclick = () => {
  confirmModal(`Clear all messages in "${currentChatLabel.textContent}"?`, async () => {
    await deleteChatMessages(currentChatId);
    await loadMessages();
  });
};

logoutBtn.onclick = () => {
  roomPassword = "";
  chatScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  passwordInput.value = "";
  messagesDiv.innerHTML = "";
  emptyState.classList.remove("hidden");
};

// ─── LOAD MESSAGES ───────────────────────────────────────────────────────────
async function loadMessages() {
  messagesDiv.innerHTML = "";
  setStatus("loading");
  const { data, error } = await db
    .from("chats").select("*")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });
  setStatus("ok");
  if (error) { setStatus("err"); renderError("Failed to load messages."); return; }
  if (data.length === 0) { messagesDiv.appendChild(emptyState); emptyState.classList.remove("hidden"); return; }
  emptyState.classList.add("hidden");
  data.forEach(msg => renderMessage(msg.role, msg.content, msg.model));
  scrollToBottom();
}

// ─── RENDER MESSAGE ──────────────────────────────────────────────────────────
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
    // Parse artifact blocks before markdown
    const processed = parseArtifacts(content, contentDiv);
    if (!processed) {
      contentDiv.innerHTML = renderMarkdown(content);
      addCodeCopyButtons(contentDiv);
    }
  }

  div.appendChild(meta);
  div.appendChild(contentDiv);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return div;
}

// ─── ARTIFACT PARSING ────────────────────────────────────────────────────────
function parseArtifacts(content, container) {
  const artifactRe = /<artifact\s+filename="([^"]+)"\s+language="([^"]+)">([\s\S]*?)<\/artifact>/gi;
  let hasArtifact = false;
  let lastIndex = 0;
  let match;
  const parts = [];

  while ((match = artifactRe.exec(content)) !== null) {
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
      const textDiv = document.createElement("div");
      textDiv.innerHTML = renderMarkdown(part.content);
      addCodeCopyButtons(textDiv);
      container.appendChild(textDiv);
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
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(part.code).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => copyBtn.textContent = "Copy", 2000);
    });
  };

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
  header.appendChild(icon);
  header.appendChild(info);
  header.appendChild(actions);

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

// Creates an empty assistant bubble ready to receive streamed text
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

  // blinking cursor
  const cursor = document.createElement("span");
  cursor.className = "stream-cursor";
  contentDiv.appendChild(cursor);

  div.appendChild(meta);
  div.appendChild(contentDiv);
  messagesDiv.appendChild(div);
  scrollToBottom();
  return { div, contentDiv, cursor };
}

// Finalise streaming bubble: re-render raw text as markdown/artifacts
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
  if (!key) { showKeyStatus("API key required", false); return; }
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

  const systemPrompt = buildSystemPrompt();
  const messages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...history]
    : history;

  let streamBubble = null;
  let rawReply = "";

  try {
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model, messages, stream: true })
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
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            rawReply += delta;
            // Live plain-text preview while streaming (fast & cheap)
            // Insert before cursor so cursor stays at end
            const textNode = document.createTextNode(delta);
            contentDiv.insertBefore(textNode, cursor);
            scrollToBottom();
          }
        } catch (_) { /* malformed chunk, skip */ }
      }
    }

    // Stream finished — re-render as proper markdown/artifacts
    finaliseStreamingBubble(contentDiv, cursor, rawReply);
    streamBubble.div.classList.remove("streaming");
    scrollToBottom();

    await saveMessage("assistant", rawReply, model);
    setStatus("ok");

  } catch (err) {
    thinkingDiv.remove();
    if (streamBubble) {
      streamBubble.div.remove();
    }
    renderError(err.message || "Request failed.");
    setStatus("err");
    setTimeout(() => setStatus("ok"), 4000);
  } finally {
    isSending = false;
    updateSendBtn();
  }
};

// ─── SYSTEM PROMPT BUILDER ───────────────────────────────────────────────────
function buildSystemPrompt() {
  const parts = [];

  // Active system prompt
  if (activeSystemPromptId) {
    const p = getPromptById(activeSystemPromptId);
    if (p) parts.push(p.text);
  }

  // Active flags
  activeFlags.forEach(flagId => {
    const f = BUILTIN_FLAGS.find(fl => fl.id === flagId);
    if (f) parts.push(f.inject);
  });

  // Attached files
  attachedFiles.forEach(f => {
    parts.push(`\n--- FILE: ${f.name} ---\n${f.content}\n--- END FILE ---`);
  });

  return parts.join("\n\n").trim();
}

function getPromptById(id) {
  const custom = getCustomPrompts();
  return BUILTIN_PROMPTS.find(p => p.id === id) || custom.find(p => p.id === id) || null;
}

// ─── PROMPT LIBRARY ──────────────────────────────────────────────────────────
function getCustomPrompts() {
  return JSON.parse(localStorage.getItem("custom_prompts") || "[]");
}

function saveCustomPrompts(arr) {
  localStorage.setItem("custom_prompts", JSON.stringify(arr));
}

function getAllPrompts() {
  return [...BUILTIN_PROMPTS, ...getCustomPrompts()];
}

function renderPromptList() {
  promptList.innerHTML = "";
  const all = getAllPrompts();
  const filtered = activeCat === "all" ? all : all.filter(p => p.category === activeCat);

  if (filtered.length === 0) {
    promptList.innerHTML = `<p class="apd-none">No prompts in this category.</p>`;
    return;
  }

  filtered.forEach(p => {
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

    info.appendChild(name);
    info.appendChild(cat);
    left.appendChild(icon);
    left.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "prompt-item-actions";

    // Toggle active
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "pi-btn" + (activeSystemPromptId === p.id ? " active" : "");
    toggleBtn.title = activeSystemPromptId === p.id ? "Deactivate" : "Set as system prompt";
    toggleBtn.textContent = activeSystemPromptId === p.id ? "✓ On" : "Set";
    toggleBtn.onclick = e => {
      e.stopPropagation();
      if (activeSystemPromptId === p.id) {
        activeSystemPromptId = null;
        localStorage.removeItem("active_system_prompt");
      } else {
        activeSystemPromptId = p.id;
        localStorage.setItem("active_system_prompt", p.id);
      }
      renderPromptList();
      updateActivePromptDisplay();
      updateActivePromptsBar();
    };

    actions.appendChild(toggleBtn);

    // Edit for custom, preview for builtin
    const editBtn = document.createElement("button");
    editBtn.className = "pi-btn";
    editBtn.title = p.builtin ? "Preview" : "Edit";
    editBtn.textContent = p.builtin ? "👁" : "✏";
    editBtn.onclick = e => {
      e.stopPropagation();
      openPromptEditor(p.builtin ? null : p.id, p);
    };
    actions.appendChild(editBtn);

    // Delete for custom
    if (!p.builtin) {
      const delBtn = document.createElement("button");
      delBtn.className = "pi-btn danger";
      delBtn.title = "Delete";
      delBtn.textContent = "✕";
      delBtn.onclick = e => {
        e.stopPropagation();
        confirmModal(`Delete prompt "${p.name}"?`, () => {
          let custom = getCustomPrompts();
          custom = custom.filter(c => c.id !== p.id);
          saveCustomPrompts(custom);
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

// ─── ACTIVE PROMPT DISPLAY ───────────────────────────────────────────────────
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

  if (!hasPrompt && !hasFlags && !hasFiles) {
    activePromptsBar.classList.add("hidden");
    return;
  }

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
  const isBuiltin = prefill && prefill.builtin;

  promptEditorTitle.textContent = isBuiltin ? "Preview Prompt" : (editId ? "Edit Prompt" : "New Prompt");
  peNameInput.value  = prefill?.name  || "";
  peCatSelect.value  = prefill?.category || "custom";
  peTextarea.value   = prefill?.text  || "";
  peIconInput.value  = prefill?.icon  || "";

  // Read-only for builtins
  [peNameInput, peCatSelect, peTextarea, peIconInput].forEach(el => {
    el.disabled = !!isBuiltin;
  });
  peSave.style.display = isBuiltin ? "none" : "";

  promptEditorModal.classList.remove("hidden");
}

peCancel.onclick = () => { promptEditorModal.classList.add("hidden"); editingPromptId = null; };

peSave.onclick = () => {
  const name = peNameInput.value.trim();
  const text = peTextarea.value.trim();
  if (!name || !text) { alert("Name and prompt text are required."); return; }

  let custom = getCustomPrompts();
  if (editingPromptId) {
    custom = custom.map(p => p.id === editingPromptId
      ? { ...p, name, category: peCatSelect.value, text, icon: peIconInput.value.trim() || "📝" }
      : p);
  } else {
    custom.push({
      id: "cp-" + Date.now(),
      name,
      category: peCatSelect.value,
      text,
      icon: peIconInput.value.trim() || "📝",
      builtin: false
    });
  }
  saveCustomPrompts(custom);
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
      if (activeFlags.includes(f.id)) {
        activeFlags = activeFlags.filter(id => id !== f.id);
      } else {
        activeFlags.push(f.id);
      }
      localStorage.setItem("active_flags", JSON.stringify(activeFlags));
      toggle.className = "flag-toggle" + (activeFlags.includes(f.id) ? " on" : "");
      updateActivePromptsBar();
    };

    const nameSpan = document.createElement("span");
    nameSpan.className = "flag-name";
    nameSpan.textContent = f.name;

    const descSpan = document.createElement("span");
    descSpan.className = "flag-desc";
    descSpan.textContent = f.desc;

    left.appendChild(toggle);

    const text = document.createElement("div");
    text.style.display = "flex";
    text.style.flexDirection = "column";
    text.style.gap = "1px";
    text.appendChild(nameSpan);
    text.appendChild(descSpan);

    row.appendChild(left);
    row.appendChild(text);
    flagsList.appendChild(row);
  });
}

// ─── FILE ATTACHMENTS ────────────────────────────────────────────────────────
fileUploadInput.onchange = async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const text = await file.text();
    // Avoid duplicates
    if (!attachedFiles.find(f => f.name === file.name)) {
      attachedFiles.push({ name: file.name, content: text });
    }
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
    del.onclick = () => {
      attachedFiles.splice(idx, 1);
      renderAttachedFiles();
      updateActivePromptsBar();
    };

    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(del);
    attachedFilesList.appendChild(row);
  });
}

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// ─── SAVE / GET HISTORY ──────────────────────────────────────────────────────
async function saveMessage(role, content, model) {
  const { error } = await db.from("chats").insert({
    room_password: roomPassword,
    chat_id: currentChatId,
    role, content, model
  });
  if (error) console.error("Save error:", error);
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
function setStatus(state) { statusDot.className = "status-dot " + (state === "ok" ? "" : state); }

// ─── MODAL ───────────────────────────────────────────────────────────────────
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

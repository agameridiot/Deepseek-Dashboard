const SUPABASE_URL = "https://oazobowvagiywvpczmti.supabase.co";
const SUPABASE_KEY = "sb_publishable_PKC7Kum1tcX-9YISwy-3Tg_jVQEJ6Je";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const loginScreen = document.getElementById("loginScreen");
const chatScreen = document.getElementById("chatScreen");
const passwordInput = document.getElementById("passwordInput");
const enterBtn = document.getElementById("enterBtn");

const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const apiKeyInput = document.getElementById("apiKeyInput");
const saveApiBtn = document.getElementById("saveApiBtn");

const modelSelect = document.getElementById("modelSelect");

let roomPassword = "";
let currentChatId = "main";
let apiKey = "";

apiKeyInput.value = localStorage.getItem("deepseek_api_key") || "";
apiKey = apiKeyInput.value;

saveApiBtn.onclick = () => {
  apiKey = apiKeyInput.value.trim();

  localStorage.setItem("deepseek_api_key", apiKey);

  alert("API key saved");
};

enterBtn.onclick = async () => {
  roomPassword = passwordInput.value.trim();

  if (!roomPassword) {
    alert("Enter password");
    return;
  }

  loginScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  await loadMessages();
};

async function loadMessages() {
  messagesDiv.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("chats")
    .select("*")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  data.forEach(msg => {
    renderMessage(msg.role, msg.content, msg.model);
  });
}

function renderMessage(role, content, model) {
  const div = document.createElement("div");

  div.className = `message ${role}`;

  div.innerHTML = `
    <div class="modelTag">${escapeHtml(model)}</div>
    <div>${escapeHtml(content)}</div>
  `;

  messagesDiv.appendChild(div);

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");

  div.textContent = text;

  return div.innerHTML;
}

sendBtn.onclick = async () => {
  const message = messageInput.value.trim();

  if (!message) return;

  if (!apiKey) {
    alert("Enter API key");
    return;
  }

  const model = modelSelect.value;

  renderMessage("user", message, model);

  await saveMessage("user", message, model);

  messageInput.value = "";

  const loadingDiv = document.createElement("div");

  loadingDiv.className = "message assistant";
  loadingDiv.textContent = "Thinking...";

  messagesDiv.appendChild(loadingDiv);

  const history = await getChatHistory();

  try {
    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: history
        })
      }
    );

    const data = await response.json();

    loadingDiv.remove();

    const reply =
      data.choices?.[0]?.message?.content ||
      "No response";

    renderMessage("assistant", reply, model);

    await saveMessage("assistant", reply, model);

  } catch (err) {
    console.error(err);

    loadingDiv.textContent = "Request failed";
  }
};

async function saveMessage(role, content, model) {
  await supabaseClient
    .from("chats")
    .insert({
      room_password: roomPassword,
      chat_id: currentChatId,
      role,
      content,
      model
    });
}

async function getChatHistory() {
  const { data } = await supabaseClient
    .from("chats")
    .select("role, content")
    .eq("room_password", roomPassword)
    .eq("chat_id", currentChatId)
    .order("created_at", { ascending: true });

  return data.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL";
const SUPABASE_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY";

const supabaseClient = supabase.createClient(
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

saveApiBtn.onclick = () => {
  apiKey = apiKeyInput.value.trim();

  localStorage.setItem("deepseek_api_key", apiKey);

  alert("API key saved for this session");
};

apiKeyInput.value = localStorage.getItem("deepseek_api_key") || "";
apiKey = apiKeyInput.value;

enterBtn.onclick = async () => {
  roomPassword = passwordInput.value.trim();

  if (!roomPassword) {
    alert("Enter password");
    return;
  }

  loginScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  loadMessages();
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
}

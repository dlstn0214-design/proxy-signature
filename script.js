const chat = document.querySelector("#chat");
const form = document.querySelector("#greetingForm");
const input = document.querySelector("#userInput");
const chips = document.querySelectorAll("[data-prompt]");

const greetings = [
  (target) => `안녕하세요, ${target}님. 오늘도 좋은 하루 보내세요.`,
  (target) => `${target}님, 반갑습니다. 함께하게 되어 기쁩니다.`,
  (target) => `안녕하세요. ${target}님께 따뜻한 인사를 전합니다.`,
  (target) => `${target}님, 오신 것을 환영합니다. 편안하고 좋은 시간 되세요.`,
];

function cleanText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function createMessage(text, type) {
  const message = document.createElement("article");
  message.className = `message ${type}`;

  if (type === "agent") {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = "AI";
    message.append(avatar);
  }

  const bubble = document.createElement("p");
  bubble.textContent = text;
  message.append(bubble);
  return message;
}

function makeGreeting(prompt) {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "좋은 아침입니다." : hour < 18 ? "좋은 오후입니다." : "편안한 저녁입니다.";
  const target = prompt || "고객";
  const template = greetings[Math.floor(Math.random() * greetings.length)];
  return `${timeGreeting} ${template(target)}`;
}

function reply(prompt) {
  const text = cleanText(prompt);
  if (!text) return;

  chat.append(createMessage(text, "user"));
  chat.append(createMessage(makeGreeting(text), "agent"));
  chat.scrollTop = chat.scrollHeight;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  reply(input.value);
  input.value = "";
  input.focus();
});

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.prompt;
    reply(input.value);
    input.value = "";
  });
});

const chat = document.querySelector("#chat");
const form = document.querySelector("#askForm");
const input = document.querySelector("#questionInput");
const statusEl = document.querySelector("#status");
const documentList = document.querySelector("#documentList");
const quickPrompts = document.querySelectorAll("[data-prompt]");

let knowledgeBase = null;

const stopWords = new Set([
  "그리고",
  "그러면",
  "어떻게",
  "무엇",
  "있나요",
  "있으면",
  "알려줘",
  "찾아줘",
  "내용",
  "관련",
  "규정",
  "절차",
]);

const queryVariants = new Map([
  ["사원", ["산원"]],
  ["회사", ["회산"]],
  ["한다", ["한단"]],
  ["취소", ["취손"]],
  ["보직", ["보질"]],
  ["휴직", ["휴질"]],
  ["복직", ["복질"]],
  ["퇴직", ["퇴질"]],
  ["승진", ["신진"]],
  ["인사", ["인산"]],
  ["취업규칙", ["취업̍칙", "취업규칙"]],
]);

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function terms(text) {
  const baseTerms = (normalize(text).match(/[가-힣a-z0-9]{2,}/g) || []).filter((term) => !stopWords.has(term));
  const expanded = [];
  for (const term of baseTerms) {
    expanded.push(term, ...(queryVariants.get(term) || []));
  }
  return [...new Set(expanded)];
}

function createMessage(type, content) {
  const message = document.createElement("article");
  message.className = `message ${type}`;

  if (type === "agent") {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = "AI";
    message.append(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (typeof content === "string") {
    const p = document.createElement("p");
    p.textContent = content;
    bubble.append(p);
  } else {
    bubble.append(content);
  }
  message.append(bubble);
  chat.append(message);
  chat.scrollTop = chat.scrollHeight;
}

function scoreChunk(chunk, queryTerms, query) {
  const text = normalize(chunk.text);
  let score = 0;
  for (const term of queryTerms) {
    if (chunk.terms.includes(term)) score += term.length >= 4 ? 6 : 3;
    if (text.includes(term)) score += 2;
  }
  if (text.includes(normalize(query))) score += 20;
  return score;
}

function search(query) {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];
  return knowledgeBase.chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTerms, query) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function uniqueReferences(results) {
  const seen = new Set();
  return results
    .map((result) => ({ title: result.title, page: result.page }))
    .filter((ref) => {
      const key = `${ref.title}-${ref.page}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function guidanceItems(results, limit = 5) {
  const items = [];
  for (const result of results) {
    const sentences = result.text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?。]|다\.|요\.|함\.|음\.)\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 12);

    for (const sentence of sentences.length ? sentences : [result.text]) {
      items.push({
        text: compact(sentence, 260),
        title: result.title,
        page: result.page,
      });
      if (items.length >= limit) return items;
    }
  }
  return items;
}

function makeAnswer(results, query) {
  const wrapper = document.createElement("div");
  const top = results.slice(0, 3);
  const intro = document.createElement("p");

  if (!top.length) {
    intro.textContent = "두 문서에서 해당 질문에 대한 근거를 찾지 못했습니다. 질문 표현을 바꾸거나 더 구체적인 키워드로 다시 검색해 주세요.";
    wrapper.append(intro);
    return wrapper;
  }

  intro.textContent = `"${query}"는 문서 기준으로 다음 순서대로 처리하세요.`;
  wrapper.append(intro);

  const list = document.createElement("ol");
  list.className = "step-list";
  const steps = guidanceItems(top);
  for (const [index, step] of steps.entries()) {
    const item = document.createElement("li");
    const action = document.createElement("p");
    if (index === 0) {
      action.textContent = `먼저 ${step.text}`;
    } else if (index === steps.length - 1) {
      action.textContent = `마지막으로 ${step.text}`;
    } else {
      action.textContent = `다음으로 ${step.text}`;
    }
    const cite = document.createElement("span");
    cite.className = "citation";
    cite.textContent = `${step.title} · p.${step.page}`;
    item.append(action, cite);
    list.append(item);
  }
  wrapper.append(list);

  const references = uniqueReferences(top);
  const pageGuide = document.createElement("p");
  pageGuide.className = "page-guide";
  pageGuide.textContent = `자세한 화면과 원문은 ${references
    .map((ref) => `${ref.title} p.${ref.page}`)
    .join(", ")} 페이지로 이동해 확인하세요.`;
  wrapper.append(pageGuide);

  if (results.length > 3) {
    const more = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `추가로 확인할 페이지 ${results.length - 3}개`;
    more.append(summary);
    for (const result of results.slice(3)) {
      const p = document.createElement("p");
      p.className = "more-evidence";
      p.textContent = `${result.title} p.${result.page} 페이지로 이동해 ${compact(result.text, 220)} 내용을 확인하세요.`;
      more.append(p);
    }
    wrapper.append(more);
  }

  return wrapper;
}

function compact(text, max = 420) {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}...`;
}

function ask(question) {
  const cleaned = question.trim();
  if (!cleaned || !knowledgeBase) return;
  createMessage("user", cleaned);
  createMessage("agent", makeAnswer(search(cleaned), cleaned));
}

function renderDocuments() {
  documentList.replaceChildren();
  for (const doc of knowledgeBase.documents) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = doc.title;
    const meta = document.createElement("span");
    meta.textContent = `${doc.pageCount}쪽 · ${doc.charCount.toLocaleString()}자`;
    item.append(name, meta);
    documentList.append(item);
  }
}

async function init() {
  try {
    const candidates = ["knowledge-base.json", "dist/knowledge-base.json"];
    let response = null;
    for (const url of candidates) {
      response = await fetch(url, { cache: "no-store" });
      if (response.ok) break;
    }
    if (!response || !response.ok) throw new Error("색인 파일을 불러오지 못했습니다.");
    knowledgeBase = await response.json();
    renderDocuments();
    statusEl.textContent = `${knowledgeBase.chunks.length.toLocaleString()}개 근거 준비`;
    input.disabled = false;
  } catch (error) {
    statusEl.textContent = "색인 없음";
    createMessage("agent", "knowledge-base.json을 찾을 수 없습니다. 먼저 npm run build를 실행해 색인을 생성해 주세요.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(input.value);
  input.value = "";
  input.focus();
});

quickPrompts.forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.prompt;
    ask(input.value);
    input.value = "";
  });
});

input.disabled = true;
init();
